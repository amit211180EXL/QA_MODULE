import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { getEnv } from '@qa/config';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const env = getEnv();
        return { secret: env.JWT_SECRET, signOptions: { expiresIn: env.JWT_EXPIRES_IN } };
      },
    }),
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
