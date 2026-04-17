import { Component, inject, signal } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { translateHttpErrorMessage } from '../../core/api-errors-pt';
import { optionalBrMobilePhoneValidator } from '../../core/br-phone-mask';
import { BrPhoneMaskDirective } from '../../core/br-phone-mask.directive';
import { AuthService } from '../../core/auth.service';
import { controlErrorMessagesPt } from '../../core/form-errors-pt';
import {
  InvitesPublicService,
  type InvitePreview,
} from '../../core/invites-public.service';

@Component({
  selector: 'app-register',
  imports: [ReactiveFormsModule, RouterLink, BrPhoneMaskDirective],
  templateUrl: './register.component.html',
  styleUrl: './register.component.scss',
})
export class RegisterComponent {
  protected readonly fieldErrorsPt = controlErrorMessagesPt;

  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly invites = inject(InvitesPublicService);

  protected readonly error = signal<string | null>(null);
  protected readonly success = signal<string | null>(null);
  protected readonly submitting = signal(false);
  protected readonly inviteToken = signal<string | null>(null);
  protected readonly invitePreview = signal<InvitePreview | null>(null);
  protected readonly invitePreviewError = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    phone: [
      '',
      [Validators.required, Validators.minLength(10), Validators.maxLength(32)],
    ],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  protected readonly inviteForm = this.fb.nonNullable.group({
    password: ['', [Validators.required, Validators.minLength(8)]],
    fullName: ['', [Validators.maxLength(255)]],
    phone: ['', [Validators.required, optionalBrMobilePhoneValidator]],
  });

  constructor() {
    const t = this.route.snapshot.queryParamMap.get('inviteToken');
    if (t) {
      this.inviteToken.set(t);
      this.invites.preview(t).subscribe({
        next: (p) => {
          this.invitePreview.set(p);
          if (!p.pendingRegistration) {
            this.inviteForm.controls.password.clearValidators();
            this.inviteForm.controls.password.updateValueAndValidity();
          }
        },
        error: (err: HttpErrorResponse) => {
          this.invitePreviewError.set(
            translateHttpErrorMessage(err, {
              network:
                'Sem conexão com o servidor. Verifique a internet e tente novamente.',
              default: 'Convite inválido ou expirado.',
            }),
          );
        },
      });
    }
  }

  submit(): void {
    this.error.set(null);
    this.success.set(null);
    const token = this.inviteToken();
    if (token) {
      if (!this.invitePreview()) {
        return;
      }
      this.submitInvite(token);
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    const { email, password, phone } = this.form.getRawValue();
    this.auth.register(email, password, phone.trim()).subscribe({
      next: () => {
        this.submitting.set(false);
        this.success.set(
          'Conta criada. Faça login com e-mail e senha ou com o celular e o código por SMS.',
        );
      },
      error: (err: HttpErrorResponse) => {
        this.submitting.set(false);
        this.error.set(this.messageFromHttp(err));
      },
    });
  }

  private submitInvite(token: string): void {
    const pr = this.invitePreview();
    if (!pr) {
      return;
    }
    if (this.inviteForm.invalid) {
      this.inviteForm.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    const { password, fullName, phone } = this.inviteForm.getRawValue();
    const fn = fullName.trim();
    const body: { phone: string; password?: string; fullName?: string } = {
      phone: phone.trim(),
    };
    if (fn.length >= 2) {
      body.fullName = fn;
    }
    if (pr.pendingRegistration) {
      body.password = password;
    }
    this.invites.accept(token, body).subscribe({
        next: () => {
          this.submitting.set(false);
          const kind = pr?.inviteKind;
          const uid = pr?.unitIdentifier;
          if (kind === 'condominium' && pr && !pr.pendingRegistration) {
            this.success.set(
              uid
                ? `Unidade vinculada à sua conta (responsável por ${uid}). Faça login para acessar o condomínio.`
                : 'Associação ao condomínio confirmada. Faça login para continuar.',
            );
            return;
          }
          this.success.set(
            kind === 'condominium'
              ? uid
                ? `Conta criada. Você é o responsável pela unidade ${uid}. Faça login para continuar.`
                : 'Conta criada com acesso ao condomínio. Faça login para continuar.'
              : 'Conta criada e unidade vinculada. Faça login para continuar.',
          );
        },
        error: (err: HttpErrorResponse) => {
          this.submitting.set(false);
          this.error.set(this.messageFromHttp(err));
        },
      });
  }

  goLogin(): void {
    void this.router.navigateByUrl('/auth/login');
  }

  private messageFromHttp(err: HttpErrorResponse): string {
    return translateHttpErrorMessage(err, {
      network:
        'Não foi possível contatar o servidor. Verifique sua conexão com a internet e tente novamente.',
      default: 'Não foi possível criar a conta.',
    });
  }
}
