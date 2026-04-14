import {
  Directive,
  ElementRef,
  forwardRef,
  HostListener,
  inject,
  OnInit,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { formatCepDisplay, toCepDigits } from './br-cep-mask';

/**
 * CEP com máscara 00000-000; o FormControl armazena só 8 dígitos.
 */
@Directive({
  standalone: true,
  selector: '[appBrCepMask]',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => BrCepMaskDirective),
      multi: true,
    },
  ],
})
export class BrCepMaskDirective implements ControlValueAccessor, OnInit {
  private readonly el = inject(ElementRef<HTMLInputElement>);

  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};
  private updating = false;

  ngOnInit(): void {
    const input = this.el.nativeElement;
    input.setAttribute('inputmode', 'numeric');
    input.setAttribute('autocomplete', 'postal-code');
  }

  writeValue(value: string | null): void {
    const digits = toCepDigits(value ?? '');
    this.el.nativeElement.value = formatCepDisplay(digits);
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
    const digits = toCepDigits(input.value);
    const masked = formatCepDisplay(digits);
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
    this.onChange(digits);
  }

  @HostListener('blur')
  onBlur(): void {
    this.onTouched();
  }
}
