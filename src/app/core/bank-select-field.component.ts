import { Component, computed, forwardRef, signal } from '@angular/core';
import {
  ControlValueAccessor,
  NG_VALUE_ACCESSOR,
} from '@angular/forms';
import { BankBrandMarkComponent } from './bank-brand-mark.component';
import { filterBrazilianBanks } from './bank-brand.util';
import type { BrazilianBankEntry } from './brazilian-banks.catalog';

@Component({
  selector: 'app-bank-select-field',
  standalone: true,
  imports: [BankBrandMarkComponent],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => BankSelectFieldComponent),
      multi: true,
    },
  ],
  template: `
    <div class="bank-select" [class.bank-select--disabled]="disabled()">
      <label class="bank-select__label" [attr.for]="inputId">
        <ng-content />
      </label>
      <input
        [id]="inputId"
        type="search"
        class="bank-select__search input"
        placeholder="Buscar banco…"
        autocomplete="off"
        [disabled]="disabled()"
        [value]="searchTerm()"
        (input)="onSearch($any($event.target).value)"
      />
      <div class="bank-select__list" role="listbox" [attr.aria-label]="listAriaLabel">
        <button
          type="button"
          class="bank-select__option"
          role="option"
          [class.bank-select__option--active]="!value()"
          [attr.aria-selected]="!value()"
          [disabled]="disabled()"
          (click)="pick(null)"
        >
          <span class="bank-select__option-text muted">— Não informar —</span>
        </button>
        @for (b of filtered(); track b.id) {
          <button
            type="button"
            class="bank-select__option"
            role="option"
            [class.bank-select__option--active]="value() === b.name"
            [attr.aria-selected]="value() === b.name"
            [disabled]="disabled()"
            (click)="pick(b)"
          >
            <app-bank-brand-mark [bank]="b" size="md" />
            <span class="bank-select__option-text">
              <span class="bank-select__option-name">{{ b.name }}</span>
              <span class="bank-select__option-compe muted">COMPE {{ b.compe }}</span>
            </span>
          </button>
        }
        @if (filtered().length === 0) {
          <p class="bank-select__empty muted">Nenhum banco encontrado.</p>
        }
      </div>
      @if (value()) {
        <p class="bank-select__picked muted">
          Selecionado:
          @if (selectedBank(); as sel) {
            <app-bank-brand-mark [bank]="sel" size="sm" />
            <strong>{{ sel.name }}</strong>
          } @else {
            <app-bank-brand-mark [bankName]="value()" size="sm" />
            <strong>{{ value() }}</strong>
            <span class="bank-select__legacy-hint">(fora da lista atual)</span>
          }
        </p>
      }
    </div>
  `,
  styles: `
    .bank-select {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }

    .bank-select--disabled {
      opacity: 0.65;
      pointer-events: none;
    }

    .bank-select__label {
      display: block;
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
    }

    .bank-select__search {
      width: 100%;
      padding: 0.45rem 0.55rem;
      border-radius: 0.5rem;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      font: inherit;
      font-size: 0.88rem;
    }

    .bank-select__list {
      max-height: 14rem;
      overflow-y: auto;
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      background: var(--surface);
    }

    .bank-select__option {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      width: 100%;
      padding: 0.45rem 0.6rem;
      border: none;
      border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
      background: transparent;
      text-align: left;
      cursor: pointer;
      font: inherit;
      color: var(--text);

      &:last-child {
        border-bottom: none;
      }

      &:hover:not(:disabled) {
        background: color-mix(in srgb, var(--accent) 8%, var(--surface));
      }

      &--active {
        background: color-mix(in srgb, var(--accent) 14%, var(--surface));
      }

      &:disabled {
        cursor: not-allowed;
      }
    }

    .bank-select__option-text {
      display: flex;
      flex-direction: column;
      gap: 0.05rem;
      min-width: 0;
    }

    .bank-select__option-name {
      font-size: 0.86rem;
      font-weight: 600;
      line-height: 1.25;
    }

    .bank-select__option-compe {
      font-size: 0.68rem;
      line-height: 1.2;
    }

    .bank-select__empty {
      margin: 0;
      padding: 0.65rem 0.75rem;
      font-size: 0.82rem;
    }

    .bank-select__picked {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.35rem;
      margin: 0;
      font-size: 0.78rem;

      strong {
        font-weight: 600;
        color: var(--text);
      }
    }

    .bank-select__legacy-hint {
      font-size: 0.68rem;
      font-style: italic;
    }

    .muted {
      color: var(--muted);
    }
  `,
})
export class BankSelectFieldComponent implements ControlValueAccessor {
  private static nextId = 0;
  protected readonly inputId = `bank-select-${++BankSelectFieldComponent.nextId}`;

  protected readonly listAriaLabel = 'Bancos brasileiros';

  protected readonly value = signal('');
  protected readonly disabled = signal(false);
  protected readonly searchTerm = signal('');

  protected readonly filtered = computed(() =>
    filterBrazilianBanks(this.searchTerm()),
  );

  protected readonly selectedBank = computed(() => {
    const name = this.value().trim();
    if (!name) {
      return null;
    }
    return (
      filterBrazilianBanks('').find((b) => b.name === name) ?? null
    );
  });

  private onChange: (v: string) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(v: string | null): void {
    this.value.set(v?.trim() ?? '');
    this.searchTerm.set('');
  }

  registerOnChange(fn: (v: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  protected onSearch(term: string): void {
    this.searchTerm.set(term);
  }

  protected pick(bank: BrazilianBankEntry | null): void {
    const next = bank?.name ?? '';
    this.value.set(next);
    this.searchTerm.set('');
    this.onChange(next);
    this.onTouched();
  }
}
