import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { getMasterClient } from '@qa/prisma-master';
import { TenantConnectionPool } from '../tenant/tenant-connection-pool.service';
import { PLAN_LIMITS, PlanType } from '@qa/shared';
import {
  CreateFormDefinitionDto,
  ListFormsDto,
  UpdateFormDefinitionDto,
  FormStatusAction,
} from './dto/forms.dto';

@Injectable()
export class FormsService {
  private readonly masterDb = getMasterClient();

  constructor(
    @Inject(TenantConnectionPool)
    private readonly pool: TenantConnectionPool,
  ) {}

  private async getDb(tenantId: string) {
    return this.pool.getClient(tenantId);
  }

  async listForms(tenantId: string, query: ListFormsDto) {
    const db = await this.getDb(tenantId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      status: query.status ?? { not: 'ARCHIVED' },
    };

    if (query.search?.trim()) {
      const s = query.search.trim();
      where.OR = [
        { formKey: { contains: s, mode: 'insensitive' } },
        { name: { contains: s, mode: 'insensitive' } },
        { description: { contains: s, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await db.$transaction([
      db.formDefinition.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ formKey: 'asc' }, { version: 'desc' }],
        select: {
          id: true,
          formKey: true,
          version: true,
          name: true,
          description: true,
          status: true,
          channels: true,
          publishedAt: true,
          createdAt: true,
        },
      }),
      db.formDefinition.count({ where }),
    ]);

    return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async getForm(tenantId: string, id: string) {
    const db = await this.getDb(tenantId);
    const form = await db.formDefinition.findUnique({ where: { id } });
    if (!form) throw new NotFoundException({ code: 'FORM_NOT_FOUND', message: 'Form not found' });
    return form;
  }

  async createForm(tenantId: string, dto: CreateFormDefinitionDto, userId: string) {
    const db = await this.getDb(tenantId);

    // Plan limit check — count non-archived forms
    const tenant = await this.masterDb.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { plan: true },
    });
    const limits = PLAN_LIMITS[tenant.plan as PlanType];
    if (limits && limits.forms !== 999_999) {
      const formCount = await db.formDefinition.count({
        where: { status: { not: 'ARCHIVED' } },
      });
      if (formCount >= limits.forms) {
        throw new BadRequestException({
          code: 'PLAN_LIMIT_EXCEEDED',
          message: `Form limit of ${limits.forms} reached on ${tenant.plan} plan. Upgrade to create more forms.`,
        });
      }
    }

    // Auto-increment version for this formKey
    const latest = await db.formDefinition.findFirst({
      where: { formKey: dto.formKey },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    const version = (latest?.version ?? 0) + 1;

    return db.formDefinition.create({
      data: {
        formKey: dto.formKey,
        version,
        name: dto.name,
        description: dto.description,
        channels: dto.channels as never,
        scoringStrategy: dto.scoringStrategy as never,
        sections: dto.sections as never,
        questions: dto.questions as never,
        metadata: dto.metadata as never,
        createdById: userId,
      },
    });
  }

  async updateForm(tenantId: string, id: string, dto: UpdateFormDefinitionDto) {
    const db = await this.getDb(tenantId);
    const form = await db.formDefinition.findUnique({ where: { id } });
    if (!form) throw new NotFoundException({ code: 'FORM_NOT_FOUND', message: 'Form not found' });
    if (form.status !== 'DRAFT') {
      throw new ConflictException({
        code: 'FORM_NOT_EDITABLE',
        message: 'Only DRAFT forms can be edited',
      });
    }

    return db.formDefinition.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.channels !== undefined && { channels: dto.channels as never }),
        ...(dto.scoringStrategy !== undefined && { scoringStrategy: dto.scoringStrategy as never }),
        ...(dto.sections !== undefined && { sections: dto.sections as never }),
        ...(dto.questions !== undefined && { questions: dto.questions as never }),
      },
    });
  }

  async changeStatus(tenantId: string, id: string, action: FormStatusAction) {
    const db = await this.getDb(tenantId);
    const form = await db.formDefinition.findUnique({ where: { id } });
    if (!form) throw new NotFoundException({ code: 'FORM_NOT_FOUND', message: 'Form not found' });

    const transitions: Record<
      string,
      { from: string[]; to: string; dateField?: string; clearField?: string }
    > = {
      publish: { from: ['DRAFT'], to: 'PUBLISHED', dateField: 'publishedAt' },
      unpublish: { from: ['PUBLISHED'], to: 'DRAFT', clearField: 'publishedAt' },
      deprecate: { from: ['PUBLISHED'], to: 'DEPRECATED', dateField: 'deprecatedAt' },
      archive: { from: ['DRAFT', 'DEPRECATED'], to: 'ARCHIVED', dateField: 'archivedAt' },
    };

    const transition = transitions[action];
    if (!transition.from.includes(form.status)) {
      throw new BadRequestException({
        code: 'INVALID_TRANSITION',
        message: `Cannot ${action} a form in ${form.status} status`,
      });
    }

    // Enforce one published form per channel.
    if (action === FormStatusAction.PUBLISH) {
      const formChannels = Array.isArray(form.channels)
        ? form.channels.filter((ch): ch is string => typeof ch === 'string')
        : [];

      const publishedForms = await db.formDefinition.findMany({
        where: {
          status: 'PUBLISHED',
          id: { not: form.id },
        },
        select: { id: true, formKey: true, version: true, channels: true },
      });

      const conflicting = publishedForms.find((published) => {
        const publishedChannels = Array.isArray(published.channels)
          ? published.channels.filter((ch): ch is string => typeof ch === 'string')
          : [];
        return publishedChannels.some((ch) => formChannels.includes(ch));
      });

      if (conflicting) {
        const conflictingChannels = Array.isArray(conflicting.channels)
          ? conflicting.channels.filter((ch): ch is string => typeof ch === 'string')
          : [];
        const overlap = conflictingChannels.filter((ch) => formChannels.includes(ch));
        throw new ConflictException({
          code: 'PUBLISHED_FORM_ALREADY_EXISTS_FOR_CHANNEL',
          message: `Cannot publish form version ${form.version}. Another form (${conflicting.formKey} v${conflicting.version}) is already published for channel(s): ${overlap.join(', ')}.`,
        });
      }
    }

    return db.formDefinition.update({
      where: { id },
      data: {
        status: transition.to as never,
        ...(transition.dateField ? { [transition.dateField]: new Date() } : {}),
        ...(transition.clearField ? { [transition.clearField]: null } : {}),
      },
    });
  }
}
