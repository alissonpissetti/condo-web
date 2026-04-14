import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

/**
 * Entrada amigável para convites: /invitations/:token → /auth/register?inviteToken=...
 * O mesmo path é usado nos links gerados pela API (FRONTEND_PUBLIC_URL).
 */
@Component({
  selector: 'app-invite-landing',
  standalone: true,
  templateUrl: './invite-landing.component.html',
  styleUrl: './invite-landing.component.scss',
})
export class InviteLandingComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  ngOnInit(): void {
    const token = this.route.snapshot.paramMap.get('token')?.trim();
    if (!token) {
      void this.router.navigate(['/auth/register']);
      return;
    }
    void this.router.navigate(['/auth/register'], {
      queryParams: { inviteToken: token },
      replaceUrl: true,
    });
  }
}
