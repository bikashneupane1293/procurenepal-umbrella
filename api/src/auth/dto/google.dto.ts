import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const PASSWORD = /^(?=.*[A-Za-z])(?=.*\d).{8,72}$/;

export class GoogleLoginDto {
  /** the ID token from Google's Sign in with Google button */
  @IsString() @MinLength(20)
  credential!: string;

  /** optional: join this organization (Org ID given by the office) */
  @IsOptional() @IsString() @MaxLength(20)
  orgCode?: string;
}

export class JoinSignupDto {
  @IsString() @MinLength(3) @MaxLength(20)
  orgCode!: string;

  @IsString() @MinLength(2) @MaxLength(120)
  fullName!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @Matches(PASSWORD, { message: 'Password must be at least 8 characters with a letter and a number' })
  password!: string;

  @IsOptional() @IsString() @MaxLength(30)
  phone?: string;
}
