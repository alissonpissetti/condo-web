import { BrAddressNumberMaskDirective } from '../../core/br-address-number-mask.directive';
import { BrCepMaskDirective } from '../../core/br-cep-mask.directive';
import { BrCpfMaskDirective } from '../../core/br-cpf-mask.directive';
import { BrPhoneMaskDirective } from '../../core/br-phone-mask.directive';
import { BRAZIL_STATES } from '../../core/br-states';
import { CepService } from '../../core/cep.service';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { translateHttpErrorMessage } from '../../core/api-errors-pt';
import { AuthService, type UpdateMePersonPayload } from '../../core/auth.service';
import { controlErrorMessagesPt } from '../../core/form-errors-pt';

function optionalMinLen(n: number): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const v = String(control.value ?? '').trim();
    if (!v.length) {
      return null;
    }
    return v.length >= n
      ? null
      : { minlength: { requiredLength: n, actualLength: v.length } };
  };
}

/** Nova senha: vazio ou pelo menos 8 caracteres. */
function optionalMin8Password(control: AbstractControl): ValidationErrors | null {
  const v = String(control.value ?? '').trim();
  if (!v.length) {
    return null;
  }
  if (v.length >= 8) {
    return null;
  }
  return { minlength: { requiredLength: 8, actualLength: v.length } };
}

const passwordBundleValidator: ValidatorFn = (
  group: AbstractControl,
): ValidationErrors | null => {
  const np = String(group.get('newPassword')?.value ?? '').trim();
  const cf = String(group.get('confirmPassword')?.value ?? '').trim();
  const cur = String(group.get('currentPassword')?.value ?? '');
  if (!np && !cf) {
    return null;
  }
  if (!np && cf) {
    return { passwordConfirmWithoutNew: true };
  }
  if (np && cf && np !== cf) {
    return { passwordMismatch: true };
  }
  if (np.length >= 8 && np === cf && !cur.trim()) {
    return { passwordCurrentRequired: true };
  }
  return null;
};

@Component({
  selector: 'app-painel-dados',
  imports: [
    ReactiveFormsModule,
    BrPhoneMaskDirective,
    BrCpfMaskDirective,
    BrCepMaskDirective,
    BrAddressNumberMaskDirective,
  ],
  templateUrl: './painel-dados.component.html',
  styleUrl: './painel-dados.component.scss',
})
export class PainelDadosComponent implements OnInit {
  protected readonly fieldErrorsPt = controlErrorMessagesPt;
  protected readonly brazilStates = BRAZIL_STATES;

  private readonly auth = inject(AuthService);
  private readonly cep = inject(CepService);
  private readonly fb = inject(FormBuilder);

  protected readonly loadError = signal<string | null>(null);
  protected readonly saveError = signal<string | null>(null);
  protected readonly saveSuccess = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly cepLookupError = signal<string | null>(null);
  protected readonly cepLookupLoading = signal(false);
  /** Já existe ficha `people` associada — enviamos o bloco `person` em cada salvamento. */
  protected readonly hasPersonProfile = signal(false);
  /** CPF que veio do servidor (para não enviar `cpf: ""` e apagar sem o utilizador o limpar). */
  private readonly initialPersonCpf = signal<string | null>(null);

  protected readonly accountSummary = signal<{
    id: string;
    createdAtLabel: string;
  } | null>(null);
  /** Id da entidade `people` quando existir. */
  protected readonly personRecordId = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group(
    {
      email: ['', [Validators.required, Validators.email]],
      phone: [
        '',
        [Validators.required, Validators.minLength(10), Validators.maxLength(32)],
      ],
      currentPassword: [''],
      newPassword: ['', [optionalMin8Password]],
      confirmPassword: [''],
      person: this.fb.nonNullable.group({
        fullName: ['', [optionalMinLen(2), Validators.maxLength(255)]],
        cpf: ['', [Validators.maxLength(11)]],
        addressZip: ['', [Validators.maxLength(8)]],
        addressStreet: ['', [Validators.maxLength(255)]],
        addressNumber: ['', [Validators.maxLength(10)]],
        addressComplement: ['', [Validators.maxLength(255)]],
        addressNeighborhood: ['', [Validators.maxLength(255)]],
        addressCity: ['', [Validators.maxLength(128)]],
        addressState: ['', [Validators.maxLength(2)]],
      }),
    },
    { validators: [passwordBundleValidator] },
  );

  ngOnInit(): void {
    this.loadError.set(null);
    this.loading.set(true);
    this.auth.getMe().subscribe({
      next: (me) => {
        this.hasPersonProfile.set(!!me.person);
        this.initialPersonCpf.set(me.person?.cpf ?? null);
        this.personRecordId.set(me.person?.id ?? null);
        this.accountSummary.set({
          id: me.id,
          createdAtLabel: new Date(me.createdAt).toLocaleDateString('pt-PT', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          }),
        });
        const p = me.person;
        this.form.patchValue({
          email: me.email,
          phone: me.phone ?? '',
          currentPassword: '',
          newPassword: '',
          confirmPassword: '',
          person: {
            fullName: p?.fullName ?? '',
            cpf: p?.cpf ?? '',
            addressZip: p?.addressZip ?? '',
            addressStreet: p?.addressStreet ?? '',
            addressNumber: p?.addressNumber ?? '',
            addressComplement: p?.addressComplement ?? '',
            addressNeighborhood: p?.addressNeighborhood ?? '',
            addressCity: p?.addressCity ?? '',
            addressState: p?.addressState ?? '',
          },
        });
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.loadError.set(
          this.messageFromHttp(err, 'Não foi possível carregar os dados.'),
        );
      },
    });
  }

  lookupCep(): void {
    this.cepLookupError.set(null);
    const digits = this.form.controls.person.controls.addressZip.value.replace(
      /\D/g,
      '',
    );
    if (digits.length !== 8) {
      this.cepLookupError.set('Introduza um CEP com 8 dígitos.');
      return;
    }
    this.cepLookupLoading.set(true);
    this.cep.lookup(digits).subscribe({
      next: (d) => {
        this.cepLookupLoading.set(false);
        this.form.controls.person.patchValue({
          addressZip: d.zip,
          addressStreet: d.street,
          addressNumber: d.number || '',
          addressComplement: d.complement || '',
          addressNeighborhood: d.neighborhood,
          addressCity: d.city,
          addressState: (d.state || '').toUpperCase().slice(0, 2),
        });
      },
      error: (err: HttpErrorResponse) => {
        this.cepLookupLoading.set(false);
        this.cepLookupError.set(
          this.messageFromHttp(err, 'Não foi possível consultar o CEP.'),
        );
      },
    });
  }

  submit(): void {
    this.saveError.set(null);
    this.saveSuccess.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    const raw = this.form.getRawValue();
    const body: {
      email: string;
      phone: string;
      currentPassword?: string;
      newPassword?: string;
      person?: UpdateMePersonPayload;
    } = {
      email: raw.email.trim(),
      phone: raw.phone.trim(),
    };
    const np = raw.newPassword.trim();
    if (np.length >= 8) {
      body.currentPassword = raw.currentPassword;
      body.newPassword = np;
    }
    if (this.shouldAttachPerson(raw)) {
      body.person = this.buildPersonPayload(raw);
    }
    this.auth.updateMe(body).subscribe({
      next: (me) => {
        this.saving.set(false);
        this.saveSuccess.set('Dados salvos com sucesso.');
        this.hasPersonProfile.set(!!me.person);
        this.initialPersonCpf.set(me.person?.cpf ?? null);
        this.personRecordId.set(me.person?.id ?? null);
        this.accountSummary.set({
          id: me.id,
          createdAtLabel: new Date(me.createdAt).toLocaleDateString('pt-PT', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          }),
        });
        const p = me.person;
        this.form.patchValue({
          email: me.email,
          phone: me.phone ?? '',
          currentPassword: '',
          newPassword: '',
          confirmPassword: '',
          person: {
            fullName: p?.fullName ?? '',
            cpf: p?.cpf ?? '',
            addressZip: p?.addressZip ?? '',
            addressStreet: p?.addressStreet ?? '',
            addressNumber: p?.addressNumber ?? '',
            addressComplement: p?.addressComplement ?? '',
            addressNeighborhood: p?.addressNeighborhood ?? '',
            addressCity: p?.addressCity ?? '',
            addressState: p?.addressState ?? '',
          },
        });
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.saveError.set(
          this.messageFromHttp(err, 'Não foi possível salvar os dados.'),
        );
      },
    });
  }

  private shouldAttachPerson(
    raw: ReturnType<(typeof this.form)['getRawValue']>,
  ): boolean {
    if (this.hasPersonProfile()) {
      return true;
    }
    const p = raw.person;
    const cpf = p.cpf.replace(/\D/g, '');
    const cep = p.addressZip.replace(/\D/g, '');
    return !!(
      p.fullName.trim() ||
      cpf.length > 0 ||
      cep.length > 0 ||
      p.addressStreet.trim() ||
      p.addressNumber.trim() ||
      p.addressNeighborhood.trim() ||
      p.addressCity.trim() ||
      p.addressState.trim() ||
      p.addressComplement.trim()
    );
  }

  private buildPersonPayload(raw: {
    person: {
      fullName: string;
      cpf: string;
      addressZip: string;
      addressStreet: string;
      addressNumber: string;
      addressComplement: string;
      addressNeighborhood: string;
      addressCity: string;
      addressState: string;
    };
  }): UpdateMePersonPayload {
    const p = raw.person;
    const cpfDigits = p.cpf.replace(/\D/g, '');
    const out: UpdateMePersonPayload = {
      fullName: p.fullName.trim() || undefined,
      addressZip: p.addressZip.replace(/\D/g, ''),
      addressStreet: p.addressStreet.trim(),
      addressNumber: p.addressNumber.trim(),
      addressComplement: p.addressComplement.trim() || undefined,
      addressNeighborhood: p.addressNeighborhood.trim(),
      addressCity: p.addressCity.trim(),
      addressState: p.addressState.trim().toUpperCase(),
    };
    if (cpfDigits.length > 0) {
      out.cpf = cpfDigits;
    } else if (this.initialPersonCpf()) {
      out.cpf = '';
    }
    return out;
  }

  private messageFromHttp(err: HttpErrorResponse, fallback: string): string {
    return translateHttpErrorMessage(err, {
      network:
        'Sem conexão com o servidor. Verifique a internet e tente novamente.',
      default: fallback,
    });
  }
}
