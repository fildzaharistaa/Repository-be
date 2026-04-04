import { IsString, IsNotEmpty, MinLength } from 'class-validator';

export class UpdateFileDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  name: string;
}
