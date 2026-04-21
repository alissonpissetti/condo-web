import { DecimalPipe, NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import type { Condominium } from '../../../core/auth.service';
import { translateHttpErrorMessage } from '../../../core/api-errors-pt';
import {
  CommunicationsApiService,
  type AudiencePreviewUser,
  type Communication,
  type CommunicationAttachmentRow,
  type CommunicationAudienceScope,
  type CommunicationRecipientRow,
  type DeliveryChannelStatus,
  type RecipientDeliveryPrefPayload,
} from '../../../core/communications-api.service';
import {
  CondominiumManagementService,
  type GroupingWithUnits,
} from '../../../core/condominium-management.service';
import { formatDateTimeDdMmYyyyHhMm } from '../../../core/date-display';
import { PlanningApiService } from '../../../core/planning-api.service';
import { PollBodyEditorComponent } from '../poll-body-editor/poll-body-editor.component';
import { switchMap } from 'rxjs';

type DeliveryToggle = { email: boolean; sms: boolean; whatsapp: boolean };

@Component({
  selector: 'app-painel-comunicacao',
  standalone: true,
  imports: [ReactiveFormsModule, PollBodyEditorComponent, NgClass, DecimalPipe],
  templateUrl: './painel-comunicacao.component.html',
  styleUrl: './painel-comunicacao.component.scss',
})
export class PainelComunicacaoComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly api = inject(CommunicationsApiService);
  private readonly planning = inject(PlanningApiService);
  private readonly mgmt = inject(CondominiumManagementService);
  private readonly fb = inject(FormBuilder);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly items = signal<Communication[]>([]);
  protected readonly selected = signal<Communication | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly access = signal<{ kind: string; role?: string } | null>(
    null,
  );
  protected readonly readConfirmedBanner = signal(false);

  protected readonly groupingsWithUnits = signal<GroupingWithUnits[]>([]);
  protected readonly structureBusy = signal(false);
  private structureLoaded = false;

  protected readonly audienceScope = signal<CommunicationAudienceScope>('units');
  protected readonly selectedUnitIds = signal<string[]>([]);
  protected readonly selectedGroupingIds = signal<string[]>([]);
  protected readonly channelEmail = signal(true);
  protected readonly channelSms = signal(true);
  protected readonly channelWhatsapp = signal(false);

  protected readonly previewBusy = signal(false);
  protected readonly previewUsers = signal<AudiencePreviewUser[]>([]);
  /** Preferências por `userId` (alinhadas à pré-visualização atual). */
  protected readonly deliveryPrefs = signal<Record<string, DeliveryToggle>>({});

  protected readonly draftForm = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(512)]],
    body: [''],
  });

  private condominiumId = '';
  /** Nome do condomínio para textos de pré-visualização (SMS / e-mail). */
  protected readonly condoName = signal('Condomínio');

  constructor() {
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((q) => {
        if (q.get('leitura') === '1') {
          this.readConfirmedBanner.set(true);
        }
      });
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('condominiumId');
    if (!id) {
      this.loading.set(false);
      this.loadError.set('Condomínio inválido.');
      return;
    }
    this.condominiumId = id;
    this.mgmt.getCondominium(id).subscribe({
      next: (co: Condominium) => {
        const n = co.name?.trim();
        if (n) {
          this.condoName.set(n);
        }
      },
      error: () => {},
    });
    this.planning.access(id).subscribe({
      next: (a) =>
        this.access.set(a.access as { kind: string; role?: string }),
      error: () => this.access.set(null),
    });

    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((pm: ParamMap) => {
        const commId = pm.get('communicationId');
        if (commId) {
          this.reloadList({ silent: true });
          this.openDetail(commId);
        } else {
          this.selected.set(null);
          this.reloadList();
        }
      });
  }

  protected isMgmt(): boolean {
    const a = this.access();
    if (!a) return false;
    if (a.kind === 'owner') return true;
    if (a.kind !== 'participant') return false;
    return (
      a.role === 'syndic' || a.role === 'sub_syndic' || a.role === 'admin'
    );
  }

  protected dismissReadBanner(): void {
    this.readConfirmedBanner.set(false);
  }

  protected flatUnitOptions(): { id: string; label: string }[] {
    const out: { id: string; label: string }[] = [];
    for (const g of this.groupingsWithUnits()) {
      const gn = g.name.trim() || '—';
      for (const u of g.units) {
        out.push({
          id: u.id,
          label: `${gn} · ${u.identifier.trim() || '—'}`,
        });
      }
    }
    return out.sort((a, b) =>
      a.label.localeCompare(b.label, 'pt', { sensitivity: 'base' }),
    );
  }

  protected groupingOptions(): { id: string; name: string }[] {
    return this.groupingsWithUnits().map((g) => ({
      id: g.id,
      name: g.name.trim() || '—',
    }));
  }

  protected loadAudienceStructure(): void {
    if (this.structureLoaded) {
      return;
    }
    this.structureBusy.set(true);
    this.mgmt.loadGroupingsWithUnits(this.condominiumId).subscribe({
      next: (rows) => {
        this.structureLoaded = true;
        this.groupingsWithUnits.set(rows);
        this.structureBusy.set(false);
      },
      error: () => {
        this.structureBusy.set(false);
      },
    });
  }

  protected setAudienceScope(scope: CommunicationAudienceScope): void {
    this.audienceScope.set(scope);
    this.previewUsers.set([]);
    this.deliveryPrefs.set({});
  }

  protected toggleUnitInAudience(unitId: string): void {
    this.selectedUnitIds.update((arr) => {
      const s = new Set(arr);
      if (s.has(unitId)) {
        s.delete(unitId);
      } else {
        s.add(unitId);
      }
      return [...s];
    });
    this.previewUsers.set([]);
  }

  protected toggleGroupingInAudience(groupingId: string): void {
    this.selectedGroupingIds.update((arr) => {
      const s = new Set(arr);
      if (s.has(groupingId)) {
        s.delete(groupingId);
      } else {
        s.add(groupingId);
      }
      return [...s];
    });
    this.previewUsers.set([]);
  }

  protected selectAllUnits(): void {
    this.selectedUnitIds.set(this.flatUnitOptions().map((o) => o.id));
    this.previewUsers.set([]);
  }

  protected clearUnitSelection(): void {
    this.selectedUnitIds.set([]);
    this.previewUsers.set([]);
  }

  protected selectAllGroupings(): void {
    this.selectedGroupingIds.set(this.groupingOptions().map((g) => g.id));
    this.previewUsers.set([]);
  }

  protected clearGroupingSelection(): void {
    this.selectedGroupingIds.set([]);
    this.previewUsers.set([]);
  }

  protected refreshPreview(): void {
    if (!this.isMgmt()) {
      return;
    }
    this.previewBusy.set(true);
    this.actionError.set(null);
    const scope = this.audienceScope();
    const body =
      scope === 'units'
        ? {
            scope,
            unitIds: this.selectedUnitIds().length
              ? this.selectedUnitIds()
              : undefined,
          }
        : {
            scope,
            groupingIds: this.selectedGroupingIds().length
              ? this.selectedGroupingIds()
              : undefined,
          };
    this.api.previewAudience(this.condominiumId, body).subscribe({
      next: (res) => {
        this.previewUsers.set(res.users);
        this.syncPrefsWithGlobals(res.users);
        this.previewBusy.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.previewBusy.set(false);
        this.actionError.set(this.msg(err));
      },
    });
  }

  private syncPrefsWithGlobals(users: AudiencePreviewUser[]): void {
    const cur = { ...this.deliveryPrefs() };
    const g: DeliveryToggle = {
      email: this.channelEmail(),
      sms: this.channelSms(),
      whatsapp: this.channelWhatsapp(),
    };
    for (const u of users) {
      if (!cur[u.userId]) {
        cur[u.userId] = {
          email: g.email && u.hasEmail,
          sms: g.sms && u.hasPhone,
          whatsapp: g.whatsapp && u.hasPhone,
        };
      } else {
        cur[u.userId] = {
          email: cur[u.userId]!.email && u.hasEmail,
          sms: cur[u.userId]!.sms && u.hasPhone,
          whatsapp: cur[u.userId]!.whatsapp && u.hasPhone,
        };
      }
    }
    this.deliveryPrefs.set(cur);
  }

  protected prefFor(userId: string): DeliveryToggle {
    return (
      this.deliveryPrefs()[userId] ?? {
        email: false,
        sms: false,
        whatsapp: false,
      }
    );
  }

  protected setPref(
    userId: string,
    key: keyof DeliveryToggle,
    value: boolean,
  ): void {
    this.deliveryPrefs.update((m) => ({
      ...m,
      [userId]: { ...this.prefFor(userId), [key]: value },
    }));
  }

  protected onGlobalChannelChange(): void {
    this.syncPrefsWithGlobals(this.previewUsers());
  }

  private parseJsonIds(raw: string | null | undefined): string[] {
    if (raw == null || !String(raw).trim()) {
      return [];
    }
    try {
      const v = JSON.parse(String(raw)) as unknown;
      return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  private hydrateAudienceFromCommunication(c: Communication): void {
    const scope: CommunicationAudienceScope =
      c.audienceScope === 'groupings' ? 'groupings' : 'units';
    this.audienceScope.set(scope);
    this.selectedUnitIds.set(this.parseJsonIds(c.audienceUnitIds ?? null));
    this.selectedGroupingIds.set(
      this.parseJsonIds(c.audienceGroupingIds ?? null),
    );
    this.channelEmail.set(c.channelEmailEnabled !== false);
    this.channelSms.set(c.channelSmsEnabled !== false);
    this.channelWhatsapp.set(c.channelWhatsappEnabled === true);
    let prefs: RecipientDeliveryPrefPayload[] = [];
    const raw = c.recipientDeliveryPrefs as unknown;
    if (Array.isArray(raw)) {
      prefs = raw as RecipientDeliveryPrefPayload[];
    } else if (typeof raw === 'string' && raw.trim()) {
      try {
        prefs = JSON.parse(raw) as RecipientDeliveryPrefPayload[];
      } catch {
        prefs = [];
      }
    }
    const map: Record<string, DeliveryToggle> = {};
    for (const p of prefs) {
      map[p.userId] = {
        email: p.email !== false,
        sms: p.sms !== false,
        whatsapp: p.whatsapp === true,
      };
    }
    this.deliveryPrefs.set(map);
    this.previewUsers.set([]);
  }

  protected reloadList(opts?: { silent?: boolean }): void {
    if (!opts?.silent) {
      this.loadError.set(null);
      this.loading.set(true);
    }
    this.api.list(this.condominiumId).subscribe({
      next: (list) => {
        this.items.set(list);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.loadError.set(this.msg(err));
      },
    });
  }

  protected navigateToDetail(id: string): void {
    void this.router.navigate([
      '/painel/condominio',
      this.condominiumId,
      'comunicacao',
      id,
    ]);
  }

  private openDetail(id: string): void {
    this.actionError.set(null);
    this.busy.set(true);
    this.api.getOne(this.condominiumId, id).subscribe({
      next: (c) => {
        this.busy.set(false);
        this.loading.set(false);
        this.selected.set(c);
        if (this.isMgmt() && (c.status === 'draft' || c.status === 'sent')) {
          this.loadAudienceStructure();
        }
        if (this.isMgmt() && c.status === 'draft') {
          this.hydrateAudienceFromCommunication(c);
          this.draftForm.patchValue({
            title: c.title,
            body: c.body ?? '',
          });
        } else if (this.isMgmt() && c.status === 'sent') {
          this.hydrateAudienceFromCommunication(c);
          this.draftForm.reset({ title: '', body: '' });
        } else {
          this.draftForm.reset({ title: '', body: '' });
        }
        if (c.status === 'sent' && !this.isMgmt()) {
          this.api.markRead(this.condominiumId, id).subscribe({
            error: () => {},
          });
        }
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.loading.set(false);
        this.actionError.set(this.msg(err));
        this.selected.set(null);
      },
    });
  }

  protected closeDetail(): void {
    void this.router.navigate([
      '/painel/condominio',
      this.condominiumId,
      'comunicacao',
    ]);
  }

  protected createDraft(): void {
    this.busy.set(true);
    this.actionError.set(null);
    this.api
      .create(this.condominiumId, { title: 'Novo informativo' })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.reloadList();
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.actionError.set(this.msg(err));
        },
      });
  }

  private buildPrefsPayloadForSave(): RecipientDeliveryPrefPayload[] {
    if (this.previewUsers().length === 0) {
      return [];
    }
    return this.buildPrefsPayload();
  }

  private buildPrefsPayload(): RecipientDeliveryPrefPayload[] {
    const users = this.previewUsers();
    return users.map((u) => {
      const p = this.prefFor(u.userId);
      return {
        userId: u.userId,
        email: p.email,
        sms: p.sms,
        whatsapp: p.whatsapp,
      };
    });
  }

  /** Audiência e canais (informativo já enviado — sem título/corpo). */
  private buildDeliveryPatchOnly(): {
    audienceScope: CommunicationAudienceScope;
    audienceUnitIds?: string[];
    audienceGroupingIds?: string[];
    channelEmailEnabled: boolean;
    channelSmsEnabled: boolean;
    channelWhatsappEnabled: boolean;
    recipientDeliveryPrefs: RecipientDeliveryPrefPayload[];
  } {
    const scope = this.audienceScope();
    return {
      audienceScope: scope,
      audienceUnitIds:
        scope === 'units' ? this.selectedUnitIds() : undefined,
      audienceGroupingIds:
        scope === 'groupings' ? this.selectedGroupingIds() : undefined,
      channelEmailEnabled: this.channelEmail(),
      channelSmsEnabled: this.channelSms(),
      channelWhatsappEnabled: this.channelWhatsapp(),
      recipientDeliveryPrefs: this.buildPrefsPayloadForSave(),
    };
  }

  private buildDraftPatch(): {
    title: string;
    body: string;
    audienceScope: CommunicationAudienceScope;
    audienceUnitIds?: string[];
    audienceGroupingIds?: string[];
    channelEmailEnabled: boolean;
    channelSmsEnabled: boolean;
    channelWhatsappEnabled: boolean;
    recipientDeliveryPrefs: RecipientDeliveryPrefPayload[];
  } {
    const v = this.draftForm.getRawValue();
    return {
      title: v.title.trim(),
      body: v.body,
      ...this.buildDeliveryPatchOnly(),
    };
  }

  protected saveDraft(): void {
    const c = this.selected();
    if (!c || c.status !== 'draft' || this.draftForm.invalid) {
      this.draftForm.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.actionError.set(null);
    this.api
      .update(this.condominiumId, c.id, this.buildDraftPatch())
      .subscribe({
        next: (updated) => {
          this.busy.set(false);
          this.selected.set(updated);
          this.hydrateAudienceFromCommunication(updated);
          this.reloadList();
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.actionError.set(this.msg(err));
        },
      });
  }

  protected sendSelected(): void {
    const c = this.selected();
    if (!c || c.status !== 'draft' || this.draftForm.invalid) {
      this.draftForm.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.actionError.set(null);
    const patch = this.buildDraftPatch();
    this.api
      .update(this.condominiumId, c.id, patch)
      .pipe(switchMap(() => this.api.send(this.condominiumId, c.id)))
      .subscribe({
        next: (sent) => {
          this.busy.set(false);
          this.selected.set(sent);
          this.reloadList();
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.actionError.set(this.msg(err));
        },
      });
  }

  protected saveDeliverySettings(): void {
    const c = this.selected();
    if (!c || c.status !== 'sent' || !this.isMgmt()) {
      return;
    }
    this.busy.set(true);
    this.actionError.set(null);
    this.api
      .update(this.condominiumId, c.id, this.buildDeliveryPatchOnly())
      .subscribe({
        next: (updated) => {
          this.busy.set(false);
          this.selected.set(updated);
          this.hydrateAudienceFromCommunication(updated);
          this.reloadList();
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.actionError.set(this.msg(err));
        },
      });
  }

  /** Grava audiência/canais e dispara novo e-mail/SMS com novos links. */
  protected resendSelected(): void {
    const c = this.selected();
    if (!c || c.status !== 'sent' || !this.isMgmt()) {
      return;
    }
    this.busy.set(true);
    this.actionError.set(null);
    const patch = this.buildDeliveryPatchOnly();
    this.api
      .update(this.condominiumId, c.id, patch)
      .pipe(switchMap(() => this.api.send(this.condominiumId, c.id)))
      .subscribe({
        next: (updated) => {
          this.busy.set(false);
          this.selected.set(updated);
          this.hydrateAudienceFromCommunication(updated);
          this.reloadList();
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.actionError.set(this.msg(err));
        },
      });
  }

  protected onAttachmentSelected(ev: Event): void {
    const c = this.selected();
    if (!c || c.status !== 'draft') return;
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.busy.set(true);
    this.actionError.set(null);
    this.api.uploadAttachment(this.condominiumId, c.id, file).subscribe({
      next: (updated) => {
        this.busy.set(false);
        this.selected.set(updated);
        this.reloadList();
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.actionError.set(this.msg(err));
      },
    });
    input.value = '';
  }

  protected removeAttachment(att: CommunicationAttachmentRow): void {
    const c = this.selected();
    if (!c || c.status !== 'draft') return;
    this.busy.set(true);
    this.actionError.set(null);
    this.api
      .deleteAttachment(this.condominiumId, c.id, att.id)
      .subscribe({
        next: (updated) => {
          this.busy.set(false);
          this.selected.set(updated);
          this.reloadList();
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.actionError.set(this.msg(err));
        },
      });
  }

  protected downloadAttachment(att: CommunicationAttachmentRow): void {
    this.busy.set(true);
    this.api
      .downloadAttachmentBlob(this.condominiumId, this.selected()!.id, att.id)
      .subscribe({
        next: (blob) => {
          this.busy.set(false);
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = att.originalFilename || 'anexo';
          a.click();
          URL.revokeObjectURL(url);
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.actionError.set(this.msg(err));
        },
      });
  }

  protected safeHtml(html: string | null | undefined): SafeHtml {
    const h = html?.trim() ?? '';
    if (!h) {
      return this.sanitizer.bypassSecurityTrustHtml('');
    }
    return this.sanitizer.bypassSecurityTrustHtml(h);
  }

  protected channelLabel(st: DeliveryChannelStatus): string {
    switch (st) {
      case 'pending':
        return 'Pendente';
      case 'sent':
        return 'Enviado';
      case 'failed':
        return 'Falhou';
      case 'skipped':
        return '—';
      default:
        return st;
    }
  }

  protected recipientRead(r: CommunicationRecipientRow): string {
    if (r.readAt) {
      const src = r.readSource ? ` · ${this.readSourceLabel(r.readSource)}` : '';
      return `Lido (${formatDateTimeDdMmYyyyHhMm(r.readAt)}${src})`;
    }
    return 'Ainda não lido';
  }

  protected readChannelLabel(ch: string): string {
    switch (ch) {
      case 'email':
        return 'E-mail';
      case 'sms':
        return 'SMS';
      case 'whatsapp':
        return 'WhatsApp';
      case 'legacy_email':
        return 'E-mail (legado)';
      case 'app':
        return 'App / painel';
      default:
        return ch;
    }
  }

  protected readAccessKindLabel(kind: string): string {
    switch (kind) {
      case 'public_view':
        return 'Abriu a página';
      case 'attachment_download':
        return 'Download de anexo';
      case 'app_panel':
        return 'Marcou como lido (app)';
      default:
        return kind;
    }
  }

  private readSourceLabel(
    src: NonNullable<CommunicationRecipientRow['readSource']>,
  ): string {
    switch (src) {
      case 'app':
        return 'painel';
      case 'email_token':
      case 'email_link':
        return 'link do e-mail';
      case 'sms_link':
        return 'link do SMS';
      case 'whatsapp_link':
        return 'link do WhatsApp';
      default:
        return src;
    }
  }

  protected fmtSentAt(iso: string | null | undefined): string {
    return formatDateTimeDdMmYyyyHhMm(iso);
  }

  private msg(err: HttpErrorResponse): string {
    return translateHttpErrorMessage(err, {
      network:
        'Sem conexão com o servidor. Verifique a internet e tente novamente.',
      default: 'Não foi possível concluir o pedido.',
    });
  }
}
