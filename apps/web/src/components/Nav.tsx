'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ACCENT = '#00FF87';

const items = [
  { href: '/app',            label: 'Dashboard', icon: '⚡' },
  { href: '/app/team',       label: 'My Team',   icon: '🟢' },
  { href: '/app/points',     label: 'Points',    icon: '📊' },
  { href: '/app/fixtures',   label: 'Fixtures',  icon: '📅' },
  { href: '/app/transfers',  label: 'Transfers', icon: '🔄' },
  { href: '/app/leagues',    label: 'Leagues',   icon: '🏆' },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800;900&display=swap');

        /* Takes the left portion of the header grid */
        .fpl-nav-inner {
          display: flex;
          align-items: center;
          gap: 2px;
          flex: 1;
          min-width: 0;
        }

        /* ── Logo ── */
        .fpl-nav-logo {
          display: flex;
          align-items: center;
          gap: 9px;
          flex-shrink: 0;
          text-decoration: none;
          margin-right: 8px;
        }

        .fpl-nav-logo-dot {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          background: ${ACCENT};
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 900;
          font-size: 13px;
          color: #0a0e1a;
          flex-shrink: 0;
        }

        .fpl-nav-logo-text {
          color: white;
          font-family: 'Barlow Condensed', Impact, sans-serif;
          font-weight: 700;
          font-size: 15px;
          letter-spacing: 0.22em;
          white-space: nowrap;
        }

        /* ── Divider ── */
        .fpl-nav-divider {
          width: 1px;
          height: 26px;
          background: rgba(255,255,255,.08);
          margin: 0 16px;
          flex-shrink: 0;
        }

        /* ── Centred links group ── */
        .fpl-nav-links {
          display: flex;
          align-items: center;
          gap: 4px;
          /* Push links to horizontal centre of the remaining space */
          flex: 1;
          justify-content: center;
        }

        /* ── Individual link ── */
        .fpl-nav-link {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 7px 16px;
          border-radius: 9px;
          border: 1px solid transparent;
          color: rgba(255,255,255,.42);
          font-family: 'Barlow Condensed', Impact, sans-serif;
          font-weight: 700;
          font-size: 13px;
          letter-spacing: 0.13em;
          text-transform: uppercase;
          text-decoration: none;
          transition: all 0.18s ease;
          white-space: nowrap;
          position: relative;
        }

        .fpl-nav-link:hover {
          color: rgba(255,255,255,.8);
          background: rgba(255,255,255,.06);
          border-color: rgba(255,255,255,.12);
        }

        .fpl-nav-link.active {
          color: ${ACCENT};
          background: ${ACCENT}16;
          border-color: ${ACCENT}40;
        }

        /* Bottom accent line for active tab */
        .fpl-nav-link.active::after {
          content: '';
          position: absolute;
          bottom: -11px;   /* sits on bottom edge of the 58px header */
          left: 50%;
          transform: translateX(-50%);
          width: 55%;
          height: 2px;
          border-radius: 2px;
          background: ${ACCENT};
        }

        .fpl-nav-icon {
          font-size: 12px;
          line-height: 1;
        }

        .fpl-nav-link.active .fpl-nav-icon {
          filter: drop-shadow(0 0 5px ${ACCENT}99);
        }

        @media (max-width: 900px) {
          .fpl-nav-logo-text { display: none; }
          .fpl-nav-link { padding: 6px 11px; font-size: 11px; }
        }

        @media (max-width: 640px) {
          .fpl-nav-icon + span { display: none; }
          .fpl-nav-link { padding: 6px 10px; }
        }
      `}</style>

      <div className="fpl-nav-inner">
        {/* Logo */}
        <Link href="/app" className="fpl-nav-logo">
          <div className="fpl-nav-logo-dot">F</div>
          <span className="fpl-nav-logo-text">FPL MANAGER</span>
        </Link>

        <div className="fpl-nav-divider" />

        {/* Centred links */}
        <div className="fpl-nav-links">
          {items.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== '/app' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`fpl-nav-link${active ? ' active' : ''}`}
              >
                <span className="fpl-nav-icon">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
