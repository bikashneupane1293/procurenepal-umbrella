import { IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

const PASSWORD = /^(?=.*[A-Za-z])(?=.*\d).{8,72}$/;

export class ActivateDto {
  @IsString()
  @IsNotEmpty()
  token: string;

  @IsString()
  @MinLength(8)
  @Matches(PASSWORD, { message: 'Password must be at least 8 characters with a letter and a number' })
  password: string;
}
