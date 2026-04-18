import { BrAddressNumberMaskDirective } from '../../core/br-address-number-mask.directive';
import { BrCepMaskDirective } from '../../core/br-cep-mask.directive';
import { BrCpfMaskDirective } from '../../core/br-cpf-mask.directive';
import { BrPhoneMaskDirective } from '../../core/br-phone-mask.directive';
import { BRAZIL_STATES } from '../../core/br-states';
import { CepService } from '../../core/cep.service';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  ElementRef,
  inject,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
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
  /** CPF que veio do servidor (para não enviar `cpf: ""` e apagar sem o usuário o limpar). */
  private readonly initialPersonCpf = signal<string | null>(null);

  protected readonly accountSummary = signal<{
    id: string;
    createdAtLabel: string;
  } | null>(null);
  /** Id da entidade `people` quando existir. */
  protected readonly personRecordId = signal<string | null>(null);

  protected readonly hasSavedSignature = signal(false);
  protected readonly signatureRecordedLabel = signal<string | null>(null);
  protected readonly sigBusy = signal(false);
  protected readonly sigMessage = signal<string | null>(null);

  private readonly sigPad = viewChild<ElementRef<HTMLCanvasElement>>('sigPad');
  private sigCtx: CanvasRenderingContext2D | null = null;
  private readonly sigCssW = 440;
  private readonly sigCssH = 150;
  private sigDrawing = false;
  private sigLastX = 0;
  private sigLastY = 0;

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
        this.applySignatureMetaFromMe(me);
        this.accountSummary.set({
          id: me.id,
          createdAtLabel: new Date(me.createdAt).toLocaleDateString('pt-BR', {
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
        setTimeout(() => {
          this.initSignaturePad();
          this.loadSavedSignatureOntoPad();
        }, 0);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.loadError.set(
          this.messageFromHttp(err, 'Não foi possível carregar os dados.'),
        );
      },
    });
  }

  /** Repõe no canvas a imagem gravada no servidor (após reload). */
  private loadSavedSignatureOntoPad(): void {
    if (!this.hasSavedSignature()) {
      return;
    }
    this.auth.getMySignatureBlob().subscribe({
      next: (blob) => {
        if (!blob || blob.size < 32) {
          return;
        }
        const ref = this.sigPad();
        if (!ref) {
          return;
        }
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          if (!this.sigCtx) {
            this.initSignaturePad();
          }
          const ctx = this.sigCtx;
          if (!ctx) {
            URL.revokeObjectURL(url);
            return;
          }
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, this.sigCssW, this.sigCssH);
          ctx.drawImage(img, 0, 0, this.sigCssW, this.sigCssH);
          URL.revokeObjectURL(url);
        };
        img.onerror = () => URL.revokeObjectURL(url);
        img.src = url;
      },
      error: () => {
        /* 404 ou rede — mantém canvas em branco */
      },
    });
  }

  protected initSignaturePad(): void {
    const ref = this.sigPad();
    if (!ref) {
      return;
    }
    const el = ref.nativeElement;
    const dpr = Math.min(
      typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
      2,
    );
    el.width = Math.floor(this.sigCssW * dpr);
    el.height = Math.floor(this.sigCssH * dpr);
    el.style.width = `${this.sigCssW}px`;
    el.style.height = `${this.sigCssH}px`;
    const ctx = el.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.1;
    ctx.strokeStyle = '#0f172a';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, this.sigCssW, this.sigCssH);
    this.sigCtx = ctx;
  }

  protected clearSignaturePad(): void {
    this.initSignaturePad();
    this.sigMessage.set(null);
  }

  protected sigPointerDown(ev: PointerEvent): void {
    if (!this.sigCtx) {
      this.initSignaturePad();
    }
    const ctx = this.sigCtx;
    const el = this.sigPad()?.nativeElement;
    if (!ctx || !el) {
      return;
    }
    ev.preventDefault();
    try {
      el.setPointerCapture(ev.pointerId);
    } catch {
      /* ignorar */
    }
    const { x, y } = this.sigPadCoords(ev);
    this.sigDrawing = true;
    this.sigLastX = x;
    this.sigLastY = y;
  }

  protected sigPointerMove(ev: PointerEvent): void {
    if (!this.sigDrawing || !this.sigCtx) {
      return;
    }
    ev.preventDefault();
    const ctx = this.sigCtx;
    const { x, y } = this.sigPadCoords(ev);
    ctx.beginPath();
    ctx.moveTo(this.sigLastX, this.sigLastY);
    ctx.lineTo(x, y);
    ctx.stroke();
    this.sigLastX = x;
    this.sigLastY = y;
  }

  protected sigPointerUp(ev: PointerEvent): void {
    if (!this.sigDrawing) {
      return;
    }
    ev.preventDefault();
    this.sigDrawing = false;
    const el = this.sigPad()?.nativeElement;
    if (el) {
      try {
        el.releasePointerCapture(ev.pointerId);
      } catch {
        /* ignorar */
      }
    }
  }

  protected saveSignature(): void {
    const el = this.sigPad()?.nativeElement;
    if (!el) {
      return;
    }
    this.sigBusy.set(true);
    this.sigMessage.set(null);
    const png = el.toDataURL('image/png');
    this.auth.putMySignature(png).subscribe({
      next: (me) => {
        this.sigBusy.set(false);
        this.sigMessage.set('Assinatura gravada. Passará a aparecer nos PDFs que gerar.');
        this.applySignatureMetaFromMe(me);
        setTimeout(() => {
          this.initSignaturePad();
          this.loadSavedSignatureOntoPad();
        }, 0);
      },
      error: (err: HttpErrorResponse) => {
        this.sigBusy.set(false);
        this.sigMessage.set(
          this.messageFromHttp(err, 'Não foi possível gravar a assinatura.'),
        );
      },
    });
  }

  protected deleteSignature(): void {
    this.sigBusy.set(true);
    this.sigMessage.set(null);
    this.auth.deleteMySignature().subscribe({
      next: (me) => {
        this.sigBusy.set(false);
        this.sigMessage.set('Assinatura removida.');
        this.applySignatureMetaFromMe(me);
        this.initSignaturePad();
      },
      error: (err: HttpErrorResponse) => {
        this.sigBusy.set(false);
        this.sigMessage.set(
          this.messageFromHttp(err, 'Não foi possível remover a assinatura.'),
        );
      },
    });
  }

  private sigPadCoords(ev: PointerEvent): { x: number; y: number } {
    const el = this.sigPad()?.nativeElement;
    if (!el) {
      return { x: 0, y: 0 };
    }
    const r = el.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * this.sigCssW;
    const y = ((ev.clientY - r.top) / r.height) * this.sigCssH;
    return { x, y };
  }

  private applySignatureMetaFromMe(me: {
    signatureRecordedAt?: string | null;
  }): void {
    const raw = me.signatureRecordedAt;
    const iso =
      raw != null && String(raw).trim() !== '' ? String(raw).trim() : null;
    this.hasSavedSignature.set(!!iso);
    this.signatureRecordedLabel.set(
      iso
        ? new Date(iso).toLocaleString('pt-BR', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : null,
    );
  }

  lookupCep(): void {
    this.cepLookupError.set(null);
    const digits = this.form.controls.person.controls.addressZip.value.replace(
      /\D/g,
      '',
    );
    if (digits.length !== 8) {
      this.cepLookupError.set('Informe um CEP com 8 dígitos.');
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
        this.applySignatureMetaFromMe(me);
        this.accountSummary.set({
          id: me.id,
          createdAtLabel: new Date(me.createdAt).toLocaleDateString('pt-BR', {
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
