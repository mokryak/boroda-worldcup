import { Menu } from "lucide-react";
import type { Route } from "../App";
import { navigation } from "../App";
import { appHref } from "../routing";
import stadiumHero from "../../assets/stadium-hero.png";

type LayoutProps = {
  children: React.ReactNode;
  route: Route;
};

export function Layout({ children, route }: LayoutProps) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href={appHref("/")} aria-label="Чемпионат по прогнозам Борода">
          <span className="brand-mark">26</span>
          <span>Борода прогнозы</span>
        </a>
        <nav className="nav" aria-label="Основная навигация">
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive = routeNameForHref(item.href) === route.name;
            return (
              <a className={isActive ? "nav-link active" : "nav-link"} href={appHref(item.href)} key={item.href}>
                <Icon size={18} aria-hidden />
                <span>{item.label}</span>
              </a>
            );
          })}
        </nav>
        <button className="icon-button menu-button" type="button" title="Меню">
          <Menu size={20} aria-hidden />
        </button>
      </header>
      <main>
        <section className="hero">
          <img src={stadiumHero} alt="" />
          <div className="hero-content">
            <p>Чемпионат мира 2026</p>
            <h1>Чемпионат по прогнозам Борода</h1>
          </div>
        </section>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}

function routeNameForHref(href: string) {
  if (href === "/predict") {
    return "predict";
  }
  if (href === "/results") {
    return "results";
  }
  return "home";
}
