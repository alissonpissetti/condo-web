import { Component, inject, signal } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { translateHttpErrorMessage } from '../../core/api-errors-pt';
import { BrPhoneMaskDirective } from '../../core/br-phone-mask.directive';
import { AuthService } from '../../core/auth.service';
import { controlErrorMessagesPt } from '../../core/form-errors-pt';
import { InvitesPublicService } from '../../core/invites-public.service';

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
  protected readonly invitePreview = signal<{
    condominiumName: string;
    unitIdentifier: string;
    emailMasked: string;
    roles: string[];
 } | null>(null);
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
    fullName: ['', [Validators.minLength(2), Validators.maxLength(255)]],
  });

  constructor() {
    const t = this.route.snapshot.queryParamMap.get('inviteToken');
    if (t) {
      this.inviteToken.set(t);
      this.invites.preview(t).subscribe({
        next: (p) => {
          this.invitePreview.set({
            condominiumName: p.condominiumName,
            unitIdentifier: p.unitIdentifier,
            emailMasked: p.emailMasked,
                       roles: p.roles,
          });
        },
        error: (err: HttpErrorResponse) => {
          this.invitePreviewError.set(
            translateHttpErrorMessage(err, {
              network:
                'Sem ligação ao servidor. Verifique a internet e tente novamente.',
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
          'Conta criada. Pode iniciar sessão com email e senha ou com o celular e o código por SMS.',
        );
      },
      error: (err: HttpErrorResponse) => {
        this.submitting.set(false);
        this.error.set(this.messageFromHttp(err));
      },
    });
  }

  private submitInvite(token: string): void {
    if (this.inviteForm.invalid) {
      this.inviteForm.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    const { password, fullName } = this.inviteForm.getRawValue();
    const fn = fullName.trim();
    this.invites
      .accept(token, {
        password,
        ...(fn.length >= 2 ? { fullName: fn } : {}),
      })
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.success.set(
            'Conta criada e unidade associada. Pode iniciar sessão.',
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
        'Não foi possível contactar o servidor. Verifique a ligação à internet e tente novamente.',
      default: 'Não foi possível criar a conta.',
    });
  }
}
