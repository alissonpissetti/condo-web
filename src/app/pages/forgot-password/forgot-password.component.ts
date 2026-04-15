import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { translateHttpErrorMessage } from '../../core/api-errors-pt';
import { AuthService } from '../../core/auth.service';
import { BrPhoneMaskDirective } from '../../core/br-phone-mask.directive';
import { controlErrorMessagesPt } from '../../core/form-errors-pt';

type ResetChannel = 'email' | 'sms';
type ResetStep = 'request' | 'code' | 'password';

function passwordsMatchGroup(
  control: AbstractControl,
): ValidationErrors | null {
  const pw = control.get('newPassword')?.value as string;
  const c = control.get('confirmPassword')?.value as string;
  if (!pw || !c || pw === c) {
    return null;
  }
  return { mismatch: true };
}

@Component({
  selector: 'app-forgot-password',
  imports: [ReactiveFormsModule, RouterLink, BrPhoneMaskDirective],
  templateUrl: './forgot-password.component.html',
  styleUrls: ['../login/login.component.scss'],
})
export class ForgotPasswordComponent {
  protected readonly fieldErrorsPt = controlErrorMessagesPt;

  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly error = signal<string | null>(null);
  protected readonly info = signal<string | null>(null);
  protected readonly success = signal<string | null>(null);
  protected readonly step = signal<ResetStep>('request');
  protected readonly channel = signal<ResetChannel>('email');
  protected readonly sending = signal(false);
  protected readonly verifying = signal(false);
  protected readonly completing = signal(false);

  private resetToken: string | null = null;

  protected readonly emailRequestForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });

  protected readonly smsRequestForm = this.fb.nonNullable.group({
    phone: [
      '',
      [Validators.required, Validators.minLength(10), Validators.maxLength(32)],
    ],
  });

  protected readonly codeForm = this.fb.nonNullable.group({
    code: [
      '',
      [Validators.required, Validators.pattern(/^\d{6}$/)],
    ],
  });

  protected readonly passwordForm = this.fb.nonNullable.group(
    {
      newPassword: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', [Validators.required, Validators.minLength(8)]],
    },
    { validators: [passwordsMatchGroup] },
  );

  setChannel(ch: ResetChannel): void {
    this.error.set(null);
    this.channel.set(ch);
  }

  submitRequest(): void {
    this.error.set(null);
    this.info.set(null);
    const ch = this.channel();
    if (ch === 'email') {
      const c = this.emailRequestForm.controls.email;
      if (c.invalid) {
        this.emailRequestForm.markAllAsTouched();
        return;
      }
    } else {
      const c = this.smsRequestForm.controls.phone;
      if (c.invalid) {
        this.smsRequestForm.markAllAsTouched();
        return;
      }
    }

    this.sending.set(true);
    const body =
      ch === 'email'
        ? {
            channel: 'email' as const,
            email: this.emailRequestForm.controls.email.value.trim(),
          }
        : {
            channel: 'sms' as const,
            phone: this.smsRequestForm.controls.phone.value.trim(),
          };

    this.auth.requestPasswordReset(body).subscribe({
      next: (res) => {
        this.sending.set(false);
        this.info.set(res.message);
        this.step.set('code');
        this.codeForm.controls.code.setValue('');
      },
      error: (err: HttpErrorResponse) => {
        this.sending.set(false);
        this.error.set(this.messageFromHttp(err));
      },
    });
  }

  submitCode(): void {
    this.error.set(null);
    if (this.codeForm.invalid) {
      this.codeForm.markAllAsTouched();
      return;
    }
    const ch = this.channel();
    const code = this.codeForm.controls.code.value.trim();
    const body =
      ch === 'email'
        ? {
            channel: 'email' as const,
            email: this.emailRequestForm.controls.email.value.trim(),
            code,
          }
        : {
            channel: 'sms' as const,
            phone: this.smsRequestForm.controls.phone.value.trim(),
            code,
          };

    this.verifying.set(true);
    this.auth.verifyPasswordReset(body).subscribe({
      next: (res) => {
        this.verifying.set(false);
        this.resetToken = res.reset_token;
        this.info.set(null);
        this.step.set('password');
        this.passwordForm.reset({ newPassword: '', confirmPassword: '' });
      },
      error: (err: HttpErrorResponse) => {
        this.verifying.set(false);
        this.error.set(this.messageFromHttp(err));
      },
    });
  }

  submitNewPassword(): void {
    this.error.set(null);
    if (!this.resetToken) {
      this.error.set('Etapa inválida. Volte ao início do processo.');
      return;
    }
    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }
    const newPassword = this.passwordForm.controls.newPassword.value;
    this.completing.set(true);
    this.auth
      .completePasswordReset(this.resetToken, newPassword)
      .subscribe({
        next: () => {
          this.completing.set(false);
          this.success.set(
            'Senha alterada com sucesso. Você já pode fazer login.',
          );
          this.resetToken = null;
        },
        error: (err: HttpErrorResponse) => {
          this.completing.set(false);
          this.error.set(this.messageFromHttp(err));
        },
      });
  }

  goLogin(): void {
    void this.router.navigateByUrl('/auth/login');
  }

  backToRequest(): void {
    this.error.set(null);
    this.info.set(null);
    this.step.set('request');
    this.resetToken = null;
    this.codeForm.controls.code.setValue('');
  }

  private messageFromHttp(err: HttpErrorResponse): string {
    return translateHttpErrorMessage(err, {
      network:
        'Não foi possível contatar o servidor. Verifique sua conexão com a internet e tente novamente.',
      default: 'Não foi possível concluir o pedido.',
    });
  }
}
