import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { translateHttpErrorMessage } from '../../core/api-errors-pt';
import { AuthService } from '../../core/auth.service';
import { BrPhoneMaskDirective } from '../../core/br-phone-mask.directive';
import { controlErrorMessagesPt } from '../../core/form-errors-pt';

type LoginMode = 'email' | 'sms';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink, BrPhoneMaskDirective],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  protected readonly fieldErrorsPt = controlErrorMessagesPt;

  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly error = signal<string | null>(null);
  protected readonly submitting = signal(false);
  protected readonly loginMode = signal<LoginMode>('email');

  protected readonly smsInfo = signal<string | null>(null);
  protected readonly smsAwaitingCode = signal(false);
  protected readonly smsSending = signal(false);
  protected readonly smsVerifying = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(1)]],
  });

  protected readonly smsForm = this.fb.nonNullable.group({
    phone: [
      '',
      [Validators.required, Validators.minLength(10), Validators.maxLength(32)],
    ],
    code: [''],
  });

  setMode(mode: LoginMode): void {
    this.error.set(null);
    this.loginMode.set(mode);
    if (mode === 'email') {
      this.resetSmsFlow();
    }
  }

  submit(): void {
    this.error.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    const { email, password } = this.form.getRawValue();
    this.auth.login(email, password).subscribe({
      next: () => void this.navigateAfterLogin(),
      error: (err: HttpErrorResponse) => {
        this.submitting.set(false);
        this.error.set(this.messageFromHttp(err));
      },
    });
  }

  onSmsFormSubmit(): void {
    if (this.smsAwaitingCode()) {
      this.submitSmsLogin();
    } else {
      this.requestSmsCode();
    }
  }

  requestSmsCode(): void {
    this.error.set(null);
    this.smsInfo.set(null);
    const phoneCtrl = this.smsForm.controls.phone;
    if (phoneCtrl.invalid) {
      phoneCtrl.markAsTouched();
      return;
    }
    this.smsSending.set(true);
    const phone = phoneCtrl.value.trim();
    this.auth.requestSmsLogin(phone).subscribe({
      next: (res) => {
        this.smsSending.set(false);
        this.smsInfo.set(res.message);
        this.smsAwaitingCode.set(true);
        const codeCtrl = this.smsForm.controls.code;
        codeCtrl.setValidators([
          Validators.required,
          Validators.pattern(/^\d{6}$/),
        ]);
        codeCtrl.updateValueAndValidity();
        codeCtrl.setValue('');
      },
      error: (err: HttpErrorResponse) => {
        this.smsSending.set(false);
        this.error.set(this.messageFromHttp(err));
      },
    });
  }

  submitSmsLogin(): void {
    if (!this.smsAwaitingCode()) {
      return;
    }
    this.error.set(null);
    if (this.smsForm.invalid) {
      this.smsForm.markAllAsTouched();
      return;
    }
    this.smsVerifying.set(true);
    const { phone, code } = this.smsForm.getRawValue();
    this.auth.verifySmsLogin(phone.trim(), code.trim()).subscribe({
      next: () => void this.navigateAfterLogin(),
      error: (err: HttpErrorResponse) => {
        this.smsVerifying.set(false);
        this.error.set(this.messageFromHttp(err));
      },
    });
  }

  changeSmsNumber(): void {
    this.resetSmsFlow();
  }

  private resetSmsFlow(): void {
    this.smsAwaitingCode.set(false);
    this.smsInfo.set(null);
    const codeCtrl = this.smsForm.controls.code;
    codeCtrl.clearValidators();
    codeCtrl.setValue('');
    codeCtrl.updateValueAndValidity({ emitEvent: false });
  }

  private navigateAfterLogin(): void {
    const raw = this.route.snapshot.queryParamMap.get('returnUrl');
    if (raw?.startsWith('/') && !raw.startsWith('//')) {
      void this.router.navigateByUrl(raw);
      return;
    }
    void this.router.navigateByUrl('/painel');
  }

  private messageFromHttp(err: HttpErrorResponse): string {
    return translateHttpErrorMessage(err, {
      network:
        'Não foi possível contatar o servidor. Verifique sua conexão com a internet e tente novamente.',
      default: 'Não foi possível fazer login.',
    });
  }
}
