import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { TenantConnectionPool } from '../tenant/tenant-connection-pool.service';
import {
  CreateFormDefinitionDto,
  UpdateFormDefinitionDto,
  FormStatusAction,
} from './dto/forms.dto';

@Injectable()
export class FormsService {
  constructor(
    @Inject(TenantConnectionPool)
    private readonly pool: TenantConnectionPool,
  ) {}

  private async getDb(tenantId: string) {
    return this.pool.getClient(tenantId);
  }

  async listForms(tenantId: string) {
    const db = await this.getDb(tenantId);
    return db.formDefinition.findMany({
      where: { status: { not: 'ARCHIVED' } },
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
    });
  }

  async getForm(tenantId: string, id: string) {
    const db = await this.getDb(tenantId);
    const form = await db.formDefinition.findUnique({ where: { id } });
    if (!form) throw new NotFoundException({ code: 'FORM_NOT_FOUND', message: 'Form not found' });
    return form;
  }

  async createForm(tenantId: string, dto: CreateFormDefinitionDto, userId: string) {
    const db = await this.getDb(tenantId);

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

    const transitions: Record<string, { from: string[]; to: string; dateField?: string }> = {
      publish: { from: ['DRAFT'], to: 'PUBLISHED', dateField: 'publishedAt' },
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

    return db.formDefinition.update({
      where: { id },
      data: {
        status: transition.to as never,
        ...(transition.dateField ? { [transition.dateField]: new Date() } : {}),
      },
    });
  }
}
