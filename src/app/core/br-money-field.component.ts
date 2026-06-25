import { Component, forwardRef, input } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import {
  formatMoneyMaskDisplay,
  moneyMaskDigitsFromDisplay,
  toMoneyMaskDigits,
} from './br-money-mask';

/**
 * Campo monetário pt-BR (R$ + máscara 5.420,00).
 * Use com formControlName ou ngModel; ao enviar, use parseReaisInputToCents
 * (ou parseSignedReaisInputToCents se allowNegative).
 */
@Component({
  selector: 'app-br-money-field',
  standalone: true,
  template: `
    <div class="input-money">
      <span class="input-money__prefix" aria-hidden="true">R$</span>
      <input
        type="text"
        class="input input--money"
        [class.input--lg]="size() === 'lg'"
        [class]="extraInputClass()"
        [attr.inputmode]="allowNegative() ? 'text' : 'decimal'"
        autocomplete="off"
        [placeholder]="placeholder()"
        [disabled]="isDisabled"
        [value]="displayValue"
        (input)="onInput($event)"
        (blur)="onBlur()"
      />
    </div>
  `,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => BrMoneyFieldComponent),
      multi: true,
    },
  ],
})
export class BrMoneyFieldComponent implements ControlValueAccessor {
  readonly size = input<'default' | 'lg'>('default');
  readonly placeholder = input('0,00');
  readonly allowNegative = input(false);
  readonly extraInputClass = input('');

  protected displayValue = '';
  protected isDisabled = false;
  private updating = false;
  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(value: string | null): void {
    this.displayValue = this.formatDisplay(value ?? '');
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.isDisabled = isDisabled;
  }

  protected onInput(ev: Event): void {
    if (this.updating) {
      return;
    }
    const input = ev.target as HTMLInputElement;
    const raw = input.value;
    const negative = this.allowNegative() && raw.trim().startsWith('-');
    const digits = toMoneyMaskDigits(raw);
    let masked = formatMoneyMaskDisplay(digits);
    if (negative) {
      masked = masked ? `-${masked}` : '-';
    }
    if (input.value !== masked) {
      this.updating = true;
      input.value = masked;
      const len = masked.length;
      try {
        input.setSelectionRange(len, len);
      } catch {
        /* ignore */
      }
      this.updating = false;
    }
    this.displayValue = masked;
    this.onChange(masked);
  }

  protected onBlur(): void {
    this.onTouched();
  }

  private formatDisplay(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }
    const negative = this.allowNegative() && trimmed.startsWith('-');
    const digits = moneyMaskDigitsFromDisplay(negative ? trimmed.slice(1) : trimmed);
    let masked = formatMoneyMaskDisplay(digits);
    if (negative && masked) {
      masked = `-${masked}`;
    } else if (negative && !masked) {
      return '-';
    }
    return masked;
  }
}
