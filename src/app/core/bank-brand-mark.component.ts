import { Component, computed, inject, input } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import {
  findBrazilianBank,
  bankLogoSvg,
} from './bank-brand.util';
import type { BrazilianBankEntry } from './brazilian-banks.catalog';

@Component({
  selector: 'app-bank-brand-mark',
  standalone: true,
  template: `
    @if (entry(); as b) {
      @if (logoSvg(); as svg) {
        <span
          class="bank-mark bank-mark--logo"
          [class]="sizeClass()"
          [innerHTML]="svg"
          [attr.aria-label]="b.name"
          role="img"
        ></span>
      } @else {
        <span
          class="bank-mark bank-mark--mono"
          [class]="sizeClass()"
          [style.background]="b.brandColor"
          [style.color]="b.brandTextColor"
          [attr.aria-label]="b.name"
          >{{ b.initials }}</span
        >
      }
    } @else if (fallbackInitials()) {
      <span
        class="bank-mark bank-mark--mono bank-mark--unknown"
        [class]="sizeClass()"
        [attr.aria-label]="bankName() ?? 'Banco'"
        >{{ fallbackInitials() }}</span
      >
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      flex-shrink: 0;
    }

    .bank-mark {
      border-radius: 0.35rem;
      flex-shrink: 0;
    }

    .bank-mark--logo {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 0;
      overflow: hidden;
      border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
    }

    .bank-mark--logo ::ng-deep svg {
      display: block;
      width: 100%;
      height: 100%;
    }

    .bank-mark--mono {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      letter-spacing: -0.02em;
      line-height: 1;
      user-select: none;
    }

    .bank-mark--sm.bank-mark--logo,
    .bank-mark--sm.bank-mark--mono {
      width: 1.35rem;
      height: 1.35rem;
      font-size: 0.48rem;
    }

    .bank-mark--md.bank-mark--logo,
    .bank-mark--md.bank-mark--mono {
      width: 1.65rem;
      height: 1.65rem;
      font-size: 0.55rem;
    }

    .bank-mark--lg.bank-mark--logo,
    .bank-mark--lg.bank-mark--mono {
      width: 2rem;
      height: 2rem;
      font-size: 0.62rem;
      border-radius: 0.45rem;
    }

    .bank-mark--unknown {
      background: var(--surface-2);
      color: var(--muted);
      border: 1px solid var(--border);
    }
  `,
})
export class BankBrandMarkComponent {
  private readonly sanitizer = inject(DomSanitizer);

  /** Nome do banco (como gravado na conta) ou entrada do catálogo. */
  readonly bankName = input<string | null>(null);
  readonly bank = input<BrazilianBankEntry | null>(null);
  readonly size = input<'sm' | 'md' | 'lg'>('md');

  protected readonly entry = computed(
    () => this.bank() ?? findBrazilianBank(this.bankName()),
  );

  protected readonly logoSvg = computed((): SafeHtml | null => {
    const b = this.entry();
    if (!b) {
      return null;
    }
    const raw = bankLogoSvg(b, this.logoSizePx());
    if (!raw) {
      return null;
    }
    return this.sanitizer.bypassSecurityTrustHtml(raw);
  });

  protected readonly fallbackInitials = computed(() => {
    const raw = this.bankName()?.trim();
    if (!raw || this.entry()) {
      return '';
    }
    const parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return raw.slice(0, 2).toUpperCase();
  });

  protected sizeClass(): string {
    return `bank-mark--${this.size()}`;
  }

  private logoSizePx(): number {
    switch (this.size()) {
      case 'sm':
        return 22;
      case 'lg':
        return 32;
      default:
        return 26;
    }
  }
}
