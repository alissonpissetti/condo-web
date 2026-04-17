import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';

export type LegalDocKind = 'privacy' | 'terms';

@Component({
  selector: 'app-legal-document',
  imports: [RouterLink],
  templateUrl: './legal-document.component.html',
  styleUrl: './legal-document.component.scss',
})
export class LegalDocumentComponent {
  private readonly route = inject(ActivatedRoute);
  protected readonly auth = inject(AuthService);
  protected readonly doc = this.route.snapshot.data['legalDoc'] as LegalDocKind;
  protected readonly year = new Date().getFullYear();
}
