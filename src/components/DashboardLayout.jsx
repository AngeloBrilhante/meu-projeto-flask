import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { getDashboardNotifications } from "../services/api";
import "../pages/Dashboard.css";

function getStoredUser() {
  try {
    const raw = localStorage.getItem("usuario");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getStoredTheme() {
  const stored = localStorage.getItem("dashboard_theme");
  return stored === "light" || stored === "dark" ? stored : "dark";
}

function IconTheme({ theme }) {
  if (theme === "dark") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7.2 7.2 0 0 0 9.8 9.8z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2v2.5M12 19.5V22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2 12h2.5M19.5 12H22M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
    </svg>
  );
}

function IconBell() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 22a2.2 2.2 0 0 0 2.1-1.6h-4.2A2.2 2.2 0 0 0 12 22zm7-5.2-1.1-1.8a3.7 3.7 0 0 1-.5-1.9v-2.5A5.4 5.4 0 0 0 13 5.3V4.8a1 1 0 1 0-2 0v.5a5.4 5.4 0 0 0-4.4 5.3v2.5a3.7 3.7 0 0 1-.5 1.9L5 16.8a1.1 1.1 0 0 0 .9 1.7h12.2a1.1 1.1 0 0 0 .9-1.7z" />
    </svg>
  );
}

export default function DashboardLayout() {
  const navigate = useNavigate();
  const [user, setUser] = useState(() => getStoredUser());
  const [theme, setTheme] = useState(() => getStoredTheme());
  const [pipelineCount, setPipelineCount] = useState(0);

  const role = (user?.role || "").toUpperCase();
  const isAdmin = role === "ADMIN";
  const isVendor = role === "VENDEDOR";
  const isDigitador = role.startsWith("DIGITADOR");
  const canAccessPipeline = isAdmin || isDigitador;
  const canAccessReport = isAdmin || isVendor || isDigitador;

  const roleLabel = isAdmin
    ? "Painel admin"
    : isDigitador
    ? "Painel digitador"
    : "Painel vendedor";

  const displayName = user?.nome || "Usuario";
  const displayEmail = user?.email || "";
  const displayInitial = useMemo(
    () => (displayName?.trim()?.charAt(0) || "U").toUpperCase(),
    [displayName]
  );

  useEffect(() => {
    setUser(getStoredUser());
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("dashboard_theme", theme);
  }, [theme]);

  useEffect(() => {
    let mounted = true;

    async function loadNotifications() {
      try {
        const data = await getDashboardNotifications();
        if (mounted) {
          setPipelineCount(Number(data?.pipeline_count || 0));
        }
      } catch (error) {
        if (mounted) {
          setPipelineCount(0);
        }
      }
    }

    loadNotifications();

    const interval = setInterval(loadNotifications, 20000);

    function refreshNotifications() {
      loadNotifications();
    }

    window.addEventListener("pipeline:changed", refreshNotifications);

    return () => {
      mounted = false;
      clearInterval(interval);
      window.removeEventListener("pipeline:changed", refreshNotifications);
    };
  }, []);

  function toggleTheme() {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("usuario");
    navigate("/");
  }

  function openPipeline() {
    if (canAccessPipeline) {
      navigate("/pipeline");
      return;
    }

    navigate("/operations-report");
  }

  return (
    <div className="appShell">
      <aside className="appSidebar">
        <div className="brandBlock">
          <div className="brandLogo">{displayInitial}</div>
          <div>
            <h2>JR Cred</h2>
            <span>{roleLabel}</span>
          </div>
        </div>

        <nav className="sidebarNav">
          <NavLink
            to="/dashboard"
            className={({ isActive }) =>
              isActive ? "sidebarLink active" : "sidebarLink"
            }
          >
            Dashboard
          </NavLink>
          <NavLink
            to="/clients"
            className={({ isActive }) =>
              isActive ? "sidebarLink active" : "sidebarLink"
            }
          >
            Clientes
          </NavLink>

          {canAccessPipeline && (
            <NavLink
              to="/pipeline"
              className={({ isActive }) =>
                isActive ? "sidebarLink active" : "sidebarLink"
              }
            >
              Esteira
            </NavLink>
          )}

          {canAccessReport && (
            <NavLink
              to="/operations-report"
              className={({ isActive }) =>
                isActive ? "sidebarLink active" : "sidebarLink"
              }
            >
              Planilha
            </NavLink>
          )}
        </nav>

        <button type="button" className="logoutButton" onClick={handleLogout}>
          Sair
        </button>
      </aside>

      <div className="appMain">
        <header className="topBar">
          <label className="searchField">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m21 21-4.4-4.4M10.8 18a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4z" />
            </svg>
            <input
              type="text"
              readOnly
              value="Pesquise ou digite o comando..."
              aria-label="Campo de pesquisa"
            />
          </label>

          <div className="topActions">
            <button
              type="button"
              className="iconButton"
              onClick={toggleTheme}
              title="Alternar tema"
            >
              <IconTheme theme={theme} />
            </button>

            <button
              type="button"
              className="iconButton bellButton"
              onClick={openPipeline}
              title={
                pipelineCount > 0
                  ? `${pipelineCount} operacoes na esteira`
                  : "Sem operacoes na esteira"
              }
            >
              <IconBell />
              {pipelineCount > 0 && (
                <span className="notificationBadge">
                  {pipelineCount > 99 ? "99+" : pipelineCount}
                </span>
              )}
            </button>

            <div className="userChip">
              <div className="userChipAvatar">{displayInitial}</div>
              <div className="userChipInfo">
                <strong>{displayName}</strong>
                <span>{displayEmail || role || "USUARIO"}</span>
              </div>
            </div>
          </div>
        </header>

        <main className="pageContent">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
