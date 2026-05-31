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
import { FlashMessageService } from '../../core/flash-message.service';
import { AuthService } from '../../core/auth.service';
import { BrPhoneMaskDirective } from '../../core/br-phone-mask.directive';
import { controlErrorMessagesPt } from '../../core/form-errors-pt';

type ResetChannel = 'email' | 'whatsapp';
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
  styleUrls: ['../login/login.component.scss', './forgot-password.component.scss'],
})
export class ForgotPasswordComponent {
  protected readonly fieldErrorsPt = controlErrorMessagesPt;

  private readonly fb = inject(FormBuilder);
  private readonly flash = inject(FlashMessageService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly info = signal<string | null>(null);
  protected readonly step = signal<ResetStep>('request');
  protected readonly channel = signal<ResetChannel>('email');
  protected readonly sending = signal(false);
  protected readonly verifying = signal(false);
  protected readonly completing = signal(false);
  protected readonly resetComplete = signal(false);

  private resetToken: string | null = null;

  protected readonly emailRequestForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });

  protected readonly whatsappRequestForm = this.fb.nonNullable.group({
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
    this.channel.set(ch);
  }

  submitRequest(): void {
    this.info.set(null);
    const ch = this.channel();
    if (ch === 'email') {
      const c = this.emailRequestForm.controls.email;
      if (c.invalid) {
        this.emailRequestForm.markAllAsTouched();
        return;
      }
    } else {
      const c = this.whatsappRequestForm.controls.phone;
      if (c.invalid) {
        this.whatsappRequestForm.markAllAsTouched();
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
            channel: 'whatsapp' as const,
            phone: this.whatsappRequestForm.controls.phone.value.trim(),
          };

    this.auth.requestPasswordReset(body).subscribe({
      next: (res) => {
        this.sending.set(false);
        if (ch === 'whatsapp') {
          this.info.set(
            'Se existir conta para este número, o código foi pedido ao WhatsApp. Abra o aplicativo e procure a mensagem da empresa; pode levar alguns segundos.',
          );
        } else {
          this.info.set(res.message);
        }
        this.step.set('code');
        this.codeForm.controls.code.setValue('');
      },
      error: (err: HttpErrorResponse) => {
        this.sending.set(false);
        this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
      },
    });
  }

  submitCode(): void {
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
            channel: 'whatsapp' as const,
            phone: this.whatsappRequestForm.controls.phone.value.trim(),
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
        this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
      },
    });
  }

  submitNewPassword(): void {
    if (!this.resetToken) {
      this.flash.warning('Etapa inválida. Volte ao início do processo.');
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
          this.resetComplete.set(true);
          this.flash.success(
            'Senha alterada com sucesso. Você já pode fazer login.',
          );
          this.resetToken = null;
        },
        error: (err: HttpErrorResponse) => {
          this.completing.set(false);
          this.flash.errorFromHttp(err, 'Não foi possível concluir o pedido.');
        },
      });
  }

  goLogin(): void {
    void this.router.navigateByUrl('/auth/login');
  }

  backToRequest(): void {
    this.info.set(null);
    this.step.set('request');
    this.resetToken = null;
    this.codeForm.controls.code.setValue('');
  }

  /** Últimos 4 dígitos do celular (só dígitos) para reforçar onde esperar o WhatsApp. */
  protected phoneSuffixHint(): string {
    const d = this.whatsappRequestForm.controls.phone.value.replace(/\D/g, '');
    if (d.length < 4) {
      return '';
    }
    return d.slice(-4);
  }
}
