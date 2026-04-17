import { computed, inject, Injectable, signal } from '@angular/core';
import { CondominiumManagementService } from './condominium-management.service';
import {
  defaultSaasPlanFeatures,
  normalizeSaasPlanFeatures,
  type SaasPlanFeatureKey,
  type SaasPlanFeatures,
} from './condominium-plan-features';

/**
 * Mantém em memória as features habilitadas pelo plano do condomínio
 * selecionado. Carrega uma vez por `id`; um segundo pedido para o mesmo
 * condomínio é ignorado.
 *
 * Features ausentes/ainda não carregadas são tratadas como HABILITADAS para
 * não prender a UI atrás de um cadeado enquanto a chamada está em voo — os
 * guards de rota continuam garantindo o bloqueio real.
 */
@Injectable({ providedIn: 'root' })
export class CondominiumPlanFeaturesStore {
  private readonly api = inject(CondominiumManagementService);

  private readonly featuresSignal = signal<SaasPlanFeatures | null>(null);
  private readonly planNameSignal = signal<string | null>(null);
  private readonly loadedForSignal = signal<string | null>(null);

  private inFlightFor: string | null = null;

  readonly features = this.featuresSignal.asReadonly();
  readonly planName = this.planNameSignal.asReadonly();
  readonly loadedFor = this.loadedForSignal.asReadonly();

  readonly loaded = computed(() => this.featuresSignal() !== null);

  /** Carrega features se ainda não estiver em cache para este `condominiumId`. */
  ensureLoaded(condominiumId: string | null | undefined): void {
    if (!condominiumId) {
      this.clear();
      return;
    }
    if (this.loadedForSignal() === condominiumId) {
      return;
    }
    if (this.inFlightFor === condominiumId) {
      return;
    }
    this.inFlightFor = condominiumId;
    this.api.getCondominium(condominiumId).subscribe({
      next: (c) => {
        if (this.inFlightFor !== condominiumId) {
          return;
        }
        this.inFlightFor = null;
        this.featuresSignal.set(
          normalizeSaasPlanFeatures(
            c.billingPlanFeatures ?? undefined,
          ),
        );
        this.planNameSignal.set(c.billingPlanName ?? null);
        this.loadedForSignal.set(condominiumId);
      },
      error: () => {
        if (this.inFlightFor !== condominiumId) {
          return;
        }
        this.inFlightFor = null;
        this.featuresSignal.set(defaultSaasPlanFeatures());
        this.planNameSignal.set(null);
        this.loadedForSignal.set(condominiumId);
      },
    });
  }

  /** Limpa o cache (troca de condomínio). */
  clear(): void {
    this.inFlightFor = null;
    this.featuresSignal.set(null);
    this.planNameSignal.set(null);
    this.loadedForSignal.set(null);
  }

  /**
   * Retorna se a feature está habilitada. Enquanto não houver resposta, devolve
   * `true` para o menu não renderizar cadeado prematuramente.
   */
  isEnabled(key: SaasPlanFeatureKey): boolean {
    const f = this.featuresSignal();
    if (!f) {
      return true;
    }
    return f[key] !== false;
  }

  /** Pronto para a UI (sem piscar): só reporta bloqueio depois do load. */
  isBlocked(key: SaasPlanFeatureKey): boolean {
    const f = this.featuresSignal();
    if (!f) {
      return false;
    }
    return f[key] === false;
  }
}
