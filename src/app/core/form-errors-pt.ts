import { AbstractControl, ValidationErrors } from '@angular/forms';

/**
 * Mensagens de validação de formulário em português (evita mensagens nativas do browser em inglês).
 */
export function controlErrorMessagesPt(
  control: AbstractControl | null,
  options?: { touchedOnly?: boolean },
): string[] {
  const touchedOnly = options?.touchedOnly ?? true;
  if (!control || (touchedOnly && !control.touched) || !control.errors) {
    return [];
  }
  const e = control.errors as ValidationErrors;
  const out: string[] = [];
  if (e['required']) {
    out.push('Este campo é obrigatório.');
  }
  if (e['email']) {
    out.push('Introduza um endereço de email válido.');
  }
  if (e['minlength']) {
    const m = e['minlength'] as {
      requiredLength: number;
      actualLength: number;
    };
    out.push(
      `É necessário pelo menos ${m.requiredLength} caracteres (atualmente tem ${m.actualLength}).`,
    );
  }
  if (e['maxlength']) {
    const m = e['maxlength'] as {
      requiredLength: number;
      actualLength: number;
    };
    out.push(
      `No máximo ${m.requiredLength} caracteres (atualmente tem ${m.actualLength}).`,
    );
  }
  if (e['pattern']) {
    out.push('O formato não é válido.');
  }
  if (e['brMobilePhone']) {
    out.push('Introduza um número de celular válido com DDD (11 dígitos).');
  }
  return out;
}
