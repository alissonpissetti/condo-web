import { Component, inject, signal } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { translateHttpErrorMessage } from '../../core/api-errors-pt';
import { BrPhoneMaskDirective } from '../../core/br-phone-mask.directive';
import { AuthService } from '../../core/auth.service';
import { controlErrorMessagesPt } from '../../core/form-errors-pt';

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

  protected readonly error = signal<string | null>(null);
  protected readonly success = signal<string | null>(null);
  protected readonly submitting = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    phone: [
      '',
      [Validators.required, Validators.minLength(10), Validators.maxLength(32)],
    ],
    password: [
      '',
      [Validators.required, Validators.minLength(8)],
    ],
  });

  submit(): void {
    this.error.set(null);
    this.success.set(null);
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
