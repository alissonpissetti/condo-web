import {
  Directive,
  ElementRef,
  forwardRef,
  HostListener,
  inject,
  OnInit,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { formatBrPhoneDisplay, toNationalPhoneDigits } from './br-phone-mask';

/**
 * Máscara de telefone BR no formato (XX) XXXXX-XXXX (móvel) ou (XX) XXXX-XXXX.
 * O valor do FormControl permanece só com dígitos (nacionais, até 11).
 */
@Directive({
  standalone: true,
  selector: '[appBrPhoneMask]',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => BrPhoneMaskDirective),
      multi: true,
    },
  ],
})
export class BrPhoneMaskDirective implements ControlValueAccessor, OnInit {
  private readonly el = inject(ElementRef<HTMLInputElement>);

  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};
  private updating = false;

  ngOnInit(): void {
    const input = this.el.nativeElement;
    input.setAttribute('inputmode', 'tel');
    input.setAttribute('autocomplete', 'tel');
  }

  writeValue(value: string | null): void {
    const digits = toNationalPhoneDigits(value ?? '');
    this.el.nativeElement.value = formatBrPhoneDisplay(digits);
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
    const digits = toNationalPhoneDigits(input.value);
    const masked = formatBrPhoneDisplay(digits);
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
