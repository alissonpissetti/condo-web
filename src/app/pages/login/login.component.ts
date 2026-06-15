import { NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  booleanAttribute,
  Component,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FlashMessageService } from '../../core/flash-message.service';
import { AuthService } from '../../core/auth.service';
import { BrPhoneMaskDirective } from '../../core/br-phone-mask.directive';
import { controlErrorMessagesPt } from '../../core/form-errors-pt';

type LoginMode = 'email' | 'whatsapp';

export type LoginNotice = {
  kind: 'info' | 'warning';
  title: string;
  message: string;
};

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink, BrPhoneMaskDirective, NgTemplateOutlet],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
  host: {
    '[class.login-embed]': 'embedded()',
  },
})
export class LoginComponent {
  /** Quando true, mostra só o cartão (ex.: modal na página inicial). */
  readonly embedded = input(false, { transform: booleanAttribute });
  /** Aviso contextual (ex.: sessão expirada no modal da home). */
  readonly notice = input<LoginNotice | null>(null);
  /** Destino pós-login vindo do componente pai (ex.: query `returnUrl` na home). */
  readonly returnAfterLogin = input<string | null>(null);
  readonly closed = output<void>();

  protected readonly fieldErrorsPt = controlErrorMessagesPt;

  private readonly fb = inject(FormBuilder);
  private readonly flash = inject(FlashMessageService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
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
    this.loginMode.set(mode);
    if (mode === 'email') {
      this.resetSmsFlow();
    }
  }

  submit(): void {
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
        this.flash.errorFromHttp(err, 'Não foi possível fazer login.');
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
        this.flash.errorFromHttp(err, 'Não foi possível fazer login.');
      },
    });
  }

  submitSmsLogin(): void {
    if (!this.smsAwaitingCode()) {
      return;
    }
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
        this.flash.errorFromHttp(err, 'Não foi possível fazer login.');
      },
    });
  }

  changeSmsNumber(): void {
    this.resetSmsFlow();
  }

  protected onCloseEmbedded(): void {
    this.closed.emit();
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
    const fromParent = this.returnAfterLogin();
    if (fromParent?.startsWith('/') && !fromParent.startsWith('//')) {
      void this.router.navigateByUrl(fromParent);
      return;
    }
    const raw = this.route.snapshot.queryParamMap.get('returnUrl');
    if (raw?.startsWith('/') && !raw.startsWith('//')) {
      void this.router.navigateByUrl(raw);
      return;
    }
    void this.router.navigateByUrl('/painel');
  }
}
