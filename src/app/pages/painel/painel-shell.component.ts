import { Component, effect, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { CondominiumNavDataService } from '../../core/condominium-nav-data.service';
import { SelectedCondominiumService } from '../../core/selected-condominium.service';

@Component({
  selector: 'app-painel-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './painel-shell.component.html',
  styleUrl: './painel-shell.component.scss',
})
export class PainelShellComponent {
  private readonly auth = inject(AuthService);
  protected readonly selectedCondo = inject(SelectedCondominiumService);
  protected readonly navData = inject(CondominiumNavDataService);

  constructor() {
    effect(() => {
      const id = this.selectedCondo.selectedId();
      this.navData.refresh(id);
    });
  }

  logout(): void {
    this.selectedCondo.clear();
    this.auth.logout();
  }
}
