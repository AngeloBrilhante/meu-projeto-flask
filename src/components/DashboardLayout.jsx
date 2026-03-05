import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getCurrentUserProfile,
  getUserNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from "../services/api";
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

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR");
}

function playNotificationSound() {
  if (typeof window === "undefined") return;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;

  try {
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    gainNode.gain.setValueAtTime(0.0001, context.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.11, context.currentTime + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);

    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.19);
    oscillator.onended = () => {
      context.close().catch(() => {});
    };
  } catch {
    // Navegador bloqueou audio automatico.
  }
}

export default function DashboardLayout() {
  const navigate = useNavigate();
  const [user, setUser] = useState(() => getStoredUser());
  const [theme, setTheme] = useState(() => getStoredTheme());
  const [pipelineCount, setPipelineCount] = useState(0);
  const [userNotifications, setUserNotifications] = useState([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notificationMenuRef = useRef(null);
  const unreadNotificationIdsRef = useRef(new Set());
  const notificationsLoadedRef = useRef(false);

  const role = (user?.role || "").toUpperCase();
  const isGlobal = role === "GLOBAL";
  const isAdmin = role === "ADMIN" || isGlobal;
  const isVendor = role === "VENDEDOR";
  const isDigitador = role.startsWith("DIGITADOR");
  const canAccessPipeline = isAdmin || isDigitador;
  const canAccessReport = isAdmin || isVendor || isDigitador;

  const roleLabel = isGlobal
    ? "Painel global"
    : isAdmin
    ? "Painel admin"
    : isDigitador
    ? "Painel digitador"
    : "Painel vendedor";

  const displayName = user?.nome || "Usuario";
  const displayEmail = user?.email || "";
  const avatarUrl = user?.foto_url || "";
  const displayInitial = useMemo(
    () => (displayName?.trim()?.charAt(0) || "U").toUpperCase(),
    [displayName]
  );

  useEffect(() => {
    let mounted = true;

    async function hydrateCurrentUser() {
      try {
        const profile = await getCurrentUserProfile();
        if (!mounted || !profile) return;

        const localUser = getStoredUser() || {};
        const merged = { ...localUser, ...profile };

        localStorage.setItem("usuario", JSON.stringify(merged));
        setUser(merged);
      } catch (error) {
        if (mounted) {
          setUser(getStoredUser());
        }
      }
    }

    setUser(getStoredUser());
    hydrateCurrentUser();

    function handleUserUpdated() {
      setUser(getStoredUser());
      hydrateCurrentUser();
    }

    window.addEventListener("user:updated", handleUserUpdated);

    return () => {
      mounted = false;
      window.removeEventListener("user:updated", handleUserUpdated);
    };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("dashboard_theme", theme);
  }, [theme]);

  useEffect(() => {
    let mounted = true;
    notificationsLoadedRef.current = false;
    unreadNotificationIdsRef.current = new Set();

    async function loadNotifications() {
      try {
        const data = await getUserNotifications({ limit: 20, unread_only: 1 });
        const notifications = Array.isArray(data?.notifications)
          ? data.notifications
          : [];
        const unreadCount = Number(data?.unread_count || 0);
        const unreadIds = new Set(
          notifications
            .map((item) => Number(item?.id))
            .filter((value) => Number.isFinite(value) && value > 0)
        );

        if (notificationsLoadedRef.current) {
          let hasNewNotification = false;
          unreadIds.forEach((notificationId) => {
            if (!unreadNotificationIdsRef.current.has(notificationId)) {
              hasNewNotification = true;
            }
          });

          if (hasNewNotification) {
            playNotificationSound();
          }
        }

        unreadNotificationIdsRef.current = unreadIds;
        notificationsLoadedRef.current = true;

        if (mounted) {
          setPipelineCount(unreadCount);
          setUserNotifications(notifications);
        }
      } catch (error) {
        notificationsLoadedRef.current = true;
        if (mounted) {
          setPipelineCount(0);
          setUserNotifications([]);
        }
      }
    }

    loadNotifications();

    const interval = setInterval(loadNotifications, 20000);

    function refreshNotifications() {
      loadNotifications();
    }

    window.addEventListener("pipeline:changed", refreshNotifications);
    window.addEventListener("notifications:refresh", refreshNotifications);

    return () => {
      mounted = false;
      clearInterval(interval);
      window.removeEventListener("pipeline:changed", refreshNotifications);
      window.removeEventListener("notifications:refresh", refreshNotifications);
    };
  }, [role]);

  useEffect(() => {
    if (!notificationsOpen) return undefined;

    function handleClickOutside(event) {
      if (!notificationMenuRef.current) return;
      if (notificationMenuRef.current.contains(event.target)) return;
      setNotificationsOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [notificationsOpen]);

  function toggleTheme() {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("usuario");
    navigate("/");
  }

  function toggleNotificationsPanel() {
    setNotificationsOpen((prev) => !prev);
  }

  async function markNotificationAsReadAndRemove(notification) {
    if (!notification) return;

    const notificationId = Number(notification.id);
    if (!Number.isFinite(notificationId) || notificationId <= 0) return;
    const wasUnread = !notification.read_at;

    if (wasUnread) {
      await markNotificationAsRead(notificationId);
    }

    unreadNotificationIdsRef.current.delete(notificationId);
    setUserNotifications((prev) =>
      prev.filter((item) => Number(item?.id) !== notificationId)
    );
    if (wasUnread) {
      setPipelineCount((prev) => Math.max(0, prev - 1));
    }
  }

  async function handleNotificationClick(notification) {
    if (!notification) return;

    try {
      await markNotificationAsReadAndRemove(notification);
    } catch (error) {
      // Mantem navegacao mesmo se falhar a marcacao de leitura.
    }

    setNotificationsOpen(false);

    if (notification.operation_id) {
      navigate(`/operations/${notification.operation_id}/ficha`);
      return;
    }

    navigate("/operations-report");
  }

  async function handleMarkNotificationRead(event, notification) {
    event.preventDefault();
    event.stopPropagation();

    try {
      await markNotificationAsReadAndRemove(notification);
    } catch (error) {
      // Sem acao: manter estado atual.
    }
  }

  async function handleMarkAllNotificationsRead(event) {
    event.preventDefault();
    event.stopPropagation();

    if (!pipelineCount) return;

    try {
      await markAllNotificationsAsRead();
      unreadNotificationIdsRef.current = new Set();
      setUserNotifications([]);
      setPipelineCount(0);
    } catch (error) {
      // Sem acao: manter estado atual.
    }
  }

  const bellTitle =
    pipelineCount > 0
      ? `${pipelineCount} notificacoes nao lidas`
      : "Sem notificacoes novas";

  return (
    <div className="appShell">
      <aside className="appSidebar">
        <div className="brandBlock">
          <div className="brandLogo">
            {avatarUrl ? (
              <img src={avatarUrl} alt={displayName} className="avatarImage" />
            ) : (
              displayInitial
            )}
          </div>
          <div>
            <h2>Aureon Capital</h2>
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
            to="/profile"
            className={({ isActive }) =>
              isActive ? "sidebarLink active" : "sidebarLink"
            }
          >
            Meu perfil
          </NavLink>
          <NavLink
            to="/clients"
            className={({ isActive }) =>
              isActive ? "sidebarLink active" : "sidebarLink"
            }
          >
            Clientes
          </NavLink>

          {isGlobal && (
            <NavLink
              to="/global/users"
              className={({ isActive }) =>
                isActive ? "sidebarLink active" : "sidebarLink"
              }
            >
              Usuarios
            </NavLink>
          )}

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

            <div className="notificationMenu" ref={notificationMenuRef}>
              <button
                type="button"
                className="iconButton bellButton"
                onClick={toggleNotificationsPanel}
                title={bellTitle}
              >
                <IconBell />
                {pipelineCount > 0 && (
                  <span className="notificationBadge">
                    {pipelineCount > 99 ? "99+" : pipelineCount}
                  </span>
                )}
              </button>

              {notificationsOpen && (
                <div className="notificationPanel">
                  <div className="notificationPanelHeader">
                    <strong>Notificacoes</strong>
                    <button
                      type="button"
                      className="notificationMarkAllBtn"
                      onClick={handleMarkAllNotificationsRead}
                      disabled={!pipelineCount}
                    >
                      Marcar todas
                    </button>
                  </div>

                  {userNotifications.length === 0 ? (
                    <p className="notificationEmpty">Sem notificacoes no momento.</p>
                  ) : (
                    <ul className="notificationList">
                      {userNotifications.map((notification) => (
                        <li
                          key={notification.id}
                          className={`notificationItem${
                            notification.read_at ? " read" : " unread"
                          }`}
                        >
                          <button
                            type="button"
                            className="notificationItemMain"
                            onClick={() => handleNotificationClick(notification)}
                          >
                            <strong>{notification.title || "Atualizacao de operacao"}</strong>
                            <span>{notification.message || "-"}</span>
                            <small>{formatDateTime(notification.created_at)}</small>
                          </button>

                          <div className="notificationItemActions">
                            <button
                              type="button"
                              className="notificationItemReadBtn"
                              onClick={(event) =>
                                handleMarkNotificationRead(event, notification)
                              }
                            >
                              Marcar como lida
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              className="userChip userChipButton"
              onClick={() => navigate("/profile")}
              title="Abrir perfil"
            >
              <div className="userChipAvatar">
                {avatarUrl ? (
                  <img src={avatarUrl} alt={displayName} className="avatarImage" />
                ) : (
                  displayInitial
                )}
              </div>
              <div className="userChipInfo">
                <strong>{displayName}</strong>
                <span>{displayEmail || role || "USUARIO"}</span>
              </div>
            </button>
          </div>
        </header>

        <main className="pageContent">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
