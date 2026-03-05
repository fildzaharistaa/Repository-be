import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Public } from '../common/decorators/public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

 // =====================
  // LOGIN
  // =====================
  @Public()
  @UseGuards(AuthGuard('local'))
  @Post('login')
    async login(@Body() loginDto: LoginDto, @Request() req) {
    return this.authService.login(loginDto);
  }
  // =====================
  // REGISTER
  // =====================
  @Public()
  @Post('register')
  async register(@Body() body: any) {
    return this.authService.register(body);
  }
}
