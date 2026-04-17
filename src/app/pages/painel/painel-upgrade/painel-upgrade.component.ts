import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CondominiumManagementService } from '../../../core/condominium-management.service';
import {
  SAAS_PLAN_FEATURE_LABELS,
  normalizeSaasPlanFeatures,
  type SaasPlanFeatureKey,
  type SaasPlanFeatures,
} from '../../../core/condominium-plan-features';

@Component({
  selector: 'app-painel-upgrade',
  imports: [RouterLink],
  templateUrl: './painel-upgrade.component.html',
  styleUrl: './painel-upgrade.component.scss',
})
export class PainelUpgradeComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(CondominiumManagementService);

  protected readonly condoId = signal<string>('');
  protected readonly loading = signal<boolean>(true);
  protected readonly planName = signal<string | null>(null);
  protected readonly features = signal<SaasPlanFeatures | null>(null);
  protected readonly requestedFeatureKey = signal<SaasPlanFeatureKey | null>(
    null,
  );
  protected readonly featureLabels = SAAS_PLAN_FEATURE_LABELS;

  protected readonly requestedFeatureLabel = computed(() => {
    const k = this.requestedFeatureKey();
    return k ? SAAS_PLAN_FEATURE_LABELS[k] : null;
  });

  protected readonly blockedFeatures = computed(() => {
    const f = this.features();
    if (!f) {
      return [] as SaasPlanFeatureKey[];
    }
    return (Object.keys(f) as SaasPlanFeatureKey[]).filter(
      (k) => f[k] === false,
    );
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('condominiumId') ?? '';
    const qp = this.route.snapshot.queryParamMap.get('feature');
    this.condoId.set(id);
    this.requestedFeatureKey.set(this.normalizeFeatureKey(qp));
    if (!id) {
      this.loading.set(false);
      return;
    }
    this.api.getCondominium(id).subscribe({
      next: (c) => {
        this.planName.set(c.billingPlanName ?? null);
        this.features.set(
          normalizeSaasPlanFeatures(c.billingPlanFeatures ?? undefined),
        );
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  private normalizeFeatureKey(raw: string | null): SaasPlanFeatureKey | null {
    if (!raw) {
      return null;
    }
    if (raw in SAAS_PLAN_FEATURE_LABELS) {
      return raw as SaasPlanFeatureKey;
    }
    return null;
  }
}
