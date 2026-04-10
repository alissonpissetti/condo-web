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
  formatAddressNumberDisplay,
  parseAddressNumberInput,
} from './br-address-number-mask';

/**
 * Número do endereço: dígitos, opcionalmente uma letra (ex.: 123-A) ou S/N.
 * O FormControl guarda valor normalizado (sem hífen entre número e letra).
 */
@Directive({
  standalone: true,
  selector: '[appBrAddressNumberMask]',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => BrAddressNumberMaskDirective),
      multi: true,
    },
  ],
})
export class BrAddressNumberMaskDirective implements ControlValueAccessor, OnInit {
  private readonly el = inject(ElementRef<HTMLInputElement>);

  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};
  private updating = false;

  ngOnInit(): void {
    this.el.nativeElement.setAttribute('autocomplete', 'off');
  }

  writeValue(value: string | null): void {
    const stored = (value ?? '').trim();
    this.el.nativeElement.value = formatAddressNumberDisplay(stored);
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
    const stored = parseAddressNumberInput(input.value);
    const masked = formatAddressNumberDisplay(stored);
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
    this.onChange(stored);
  }

  @HostListener('blur')
  onBlur(): void {
    this.onTouched();
  }
}
