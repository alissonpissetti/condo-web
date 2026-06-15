import {
  Directive,
  ElementRef,
  forwardRef,
  HostListener,
  inject,
  OnInit,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import {
  formatMoneyMaskDisplay,
  moneyMaskDigitsFromDisplay,
  toMoneyMaskDigits,
} from './br-money-mask';

/**
 * Valor em reais com máscara pt-BR (ex.: 5.420,00).
 * O FormControl armazena o texto mascarado; use parseReaisInputToCents ao enviar.
 */
@Directive({
  standalone: true,
  selector: 'input[appBrMoneyMask]',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => BrMoneyMaskDirective),
      multi: true,
    },
  ],
})
export class BrMoneyMaskDirective implements ControlValueAccessor, OnInit {
  private readonly el = inject(ElementRef<HTMLInputElement>);

  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};
  private updating = false;

  ngOnInit(): void {
    const input = this.el.nativeElement;
    input.setAttribute('inputmode', 'decimal');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('placeholder', input.getAttribute('placeholder') ?? '0,00');
  }

  writeValue(value: string | null): void {
    const digits = moneyMaskDigitsFromDisplay(value);
    this.el.nativeElement.value = formatMoneyMaskDisplay(digits);
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.el.nativeElement.disabled = isDisabled;
  }

  @HostListener('input')
  onInput(): void {
    if (this.updating) {
      return;
    }
    const input = this.el.nativeElement;
    const digits = toMoneyMaskDigits(input.value);
    const masked = formatMoneyMaskDisplay(digits);
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
    this.onChange(masked);
  }

  @HostListener('blur')
  onBlur(): void {
    this.onTouched();
  }
}
