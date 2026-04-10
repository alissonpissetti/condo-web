import {
  Directive,
  ElementRef,
  forwardRef,
  HostListener,
  inject,
  OnInit,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { formatCpfDisplay, toCpfDigits } from './br-cpf-mask';

/**
 * CPF com máscara 000.000.000-00; o FormControl guarda só dígitos (até 11).
 */
@Directive({
  standalone: true,
  selector: '[appBrCpfMask]',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => BrCpfMaskDirective),
      multi: true,
    },
  ],
})
export class BrCpfMaskDirective implements ControlValueAccessor, OnInit {
  private readonly el = inject(ElementRef<HTMLInputElement>);

  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};
  private updating = false;

  ngOnInit(): void {
    const input = this.el.nativeElement;
    input.setAttribute('inputmode', 'numeric');
    input.setAttribute('autocomplete', 'off');
  }

  writeValue(value: string | null): void {
    const digits = toCpfDigits(value ?? '');
    this.el.nativeElement.value = formatCpfDisplay(digits);
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
    const digits = toCpfDigits(input.value);
    const masked = formatCpfDisplay(digits);
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
