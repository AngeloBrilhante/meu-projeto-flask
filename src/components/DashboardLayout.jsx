import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getCurrentUserProfile,
  searchGlobal,
  getUserNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from "../services/api";
import "../pages/Dashboard.css";
import { formatDateTimeDisplayValue } from "../utils/date";

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

function formatCpf(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 11) return String(value || "").trim();
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

function buildSearchRoute(path, searchTerm) {
  const query = String(searchTerm || "").trim();
  if (!query) return path;
  return `${path}?search=${encodeURIComponent(query)}`;
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
  const [globalSearch, setGlobalSearch] = useState("");
  const [searchClients, setSearchClients] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlightedSearchIndex, setHighlightedSearchIndex] = useState(0);
  const notificationMenuRef = useRef(null);
  const searchBoxRef = useRef(null);
  const searchRequestIdRef = useRef(0);
  const unreadNotificationIdsRef = useRef(new Set());
  const notificationsLoadedRef = useRef(false);

  const role = (user?.role || "").toUpperCase();
  const isGlobal = role === "GLOBAL";
  const isAdmin = role === "ADMIN" || isGlobal;
  const isVendor = role === "VENDEDOR";
  const isDigitador = role.startsWith("DIGITADOR");
  const canAccessPipeline = isAdmin || isDigitador || isVendor;
  const canAccessReadyPipeline = isAdmin || isDigitador;
  const canAccessReport = isAdmin || isVendor || isDigitador;
  const canAccessSalesBoard = isAdmin;

  const roleLabel = isGlobal
    ? "Painel global"
    : isAdmin
    ? "Painel admin"
    : isDigitador
    ? "Painel digitador"
    : "Painel vendedor";

  const displayName = user?.nome || "Usuario";
  const displayEmail = user?.email || "";
  const companyName = user?.empresa?.nome || "Aureon Capital";
  const avatarUrl = user?.foto_url || "";
  const displayInitial = useMemo(
    () => (displayName?.trim()?.charAt(0) || "U").toUpperCase(),
    [displayName]
  );
  const trimmedGlobalSearch = String(globalSearch || "").trim();
  const searchOptions = useMemo(() => {
    const options = [];
    const hasTerm = trimmedGlobalSearch.length >= 2;

    if (hasTerm) {
      searchClients.forEach((client) => {
        const clientId = Number(client?.id);
        if (!Number.isFinite(clientId) || clientId <= 0) return;

        const nome = String(client?.nome || `Cliente #${clientId}`).trim();
        const cpf = formatCpf(client?.cpf);
        const beneficio = String(client?.numero_beneficio || "").trim();
        const meta = [cpf ? `CPF ${cpf}` : "", beneficio ? `Beneficio ${beneficio}` : ""]
          .filter(Boolean)
          .join(" · ");

        options.push(
          {
            key: `client-docs-${clientId}`,
            title: nome,
            subtitle: meta || "Abrir documentos do cliente",
            scope: "Cliente",
            route: `/clients/${clientId}/documentos`,
          },
          {
            key: `client-ops-${clientId}`,
            title: nome,
            subtitle: "Abrir operacoes do cliente",
            scope: "Operacoes",
            route: `/clients/${clientId}/operacoes`,
          },
          {
            key: `client-comments-${clientId}`,
            title: nome,
            subtitle: "Abrir comentarios do cliente",
            scope: "Comentarios",
            route: `/clients/${clientId}/comentarios`,
          }
        );
      });

      if (canAccessPipeline) {
        options.push({
          key: "pipeline-active-search",
          title: `Buscar "${trimmedGlobalSearch}" na Esteira`,
          subtitle: "Abre a esteira com filtro aplicado",
          scope: "Esteira",
          route: buildSearchRoute("/pipeline", trimmedGlobalSearch),
        });
      }

      if (canAccessReadyPipeline) {
        options.push({
          key: "pipeline-ready-search",
          title: `Buscar "${trimmedGlobalSearch}" em Prontas para digitar`,
          subtitle: "Abre a esteira de prontas com filtro aplicado",
          scope: "Prontas",
          route: buildSearchRoute("/pipeline/prontas", trimmedGlobalSearch),
        });
      }

      if (canAccessReport) {
        options.push({
          key: "report-search",
          title: `Buscar "${trimmedGlobalSearch}" na Planilha`,
          subtitle: "Abre a planilha com filtro de busca",
          scope: "Planilha",
          route: buildSearchRoute("/operations-report", trimmedGlobalSearch),
        });
      }
    }

    return options.slice(0, 20);
  }, [searchClients, trimmedGlobalSearch, canAccessPipeline, canAccessReadyPipeline, canAccessReport]);

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
    const query = trimmedGlobalSearch;
    if (query.length < 2) {
      searchRequestIdRef.current += 1;
      setSearchClients([]);
      setSearchLoading(false);
      return undefined;
    }

    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;
    setSearchLoading(true);

    const timer = setTimeout(async () => {
      try {
        const data = await searchGlobal(query, 6);
        if (searchRequestIdRef.current !== requestId) return;
        const clients = Array.isArray(data?.clients) ? data.clients : [];
        setSearchClients(clients);
      } catch {
        if (searchRequestIdRef.current !== requestId) return;
        setSearchClients([]);
      } finally {
        if (searchRequestIdRef.current === requestId) {
          setSearchLoading(false);
        }
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [trimmedGlobalSearch]);

  useEffect(() => {
    setHighlightedSearchIndex(0);
  }, [searchOptions]);

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

  useEffect(() => {
    if (!searchOpen) return undefined;

    function handleClickOutside(event) {
      if (!searchBoxRef.current) return;
      if (searchBoxRef.current.contains(event.target)) return;
      setSearchOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [searchOpen]);

  function toggleTheme() {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }

  function handleSearchInputChange(event) {
    const value = event.target.value;
    setGlobalSearch(value);
    setSearchOpen(true);
  }

  function handleSearchOptionSelect(option) {
    if (!option?.route) return;

    setSearchOpen(false);
    setGlobalSearch("");
    setSearchClients([]);
    setHighlightedSearchIndex(0);
    navigate(option.route);
  }

  function handleSearchKeyDown(event) {
    if (!searchOptions.length) {
      if (event.key === "Escape") {
        setSearchOpen(false);
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSearchOpen(true);
      setHighlightedSearchIndex((prev) =>
        prev + 1 >= searchOptions.length ? 0 : prev + 1
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSearchOpen(true);
      setHighlightedSearchIndex((prev) =>
        prev - 1 < 0 ? searchOptions.length - 1 : prev - 1
      );
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const option = searchOptions[highlightedSearchIndex] || searchOptions[0];
      handleSearchOptionSelect(option);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setSearchOpen(false);
    }
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

  function isCommentNotification(notification) {
    const title = String(notification?.title || "").trim().toUpperCase();
    return title.includes("NOVO COMENTARIO");
  }

  async function handleNotificationClick(notification) {
    if (!notification) return;

    try {
      await markNotificationAsReadAndRemove(notification);
    } catch (error) {
      // Mantem navegacao mesmo se falhar a marcacao de leitura.
    }

    setNotificationsOpen(false);

    if (notification.operation_id && notification.cliente_id && isCommentNotification(notification)) {
      navigate(
        `/clients/${notification.cliente_id}/comentarios?operation_id=${notification.operation_id}`
      );
      return;
    }

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
            <h2>{companyName}</h2>
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
	          {canAccessSalesBoard && (
	            <NavLink
	              to="/sales-dashboard"
	              className={({ isActive }) =>
	                isActive ? "sidebarLink active" : "sidebarLink"
	              }
	            >
	              Dashboard vendas
	            </NavLink>
	          )}
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
            <>
              <NavLink
                to="/pipeline"
                end
                className={({ isActive }) =>
                  isActive ? "sidebarLink active" : "sidebarLink"
                }
              >
                Esteira
              </NavLink>
              {canAccessReadyPipeline && (
                <NavLink
                  to="/pipeline/prontas"
                  className={({ isActive }) =>
                    isActive ? "sidebarLink active" : "sidebarLink"
                  }
                >
                  Prontas para digitar
                </NavLink>
              )}
            </>
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
          <div className="searchFieldWrap" ref={searchBoxRef}>
            <label className="searchField">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m21 21-4.4-4.4M10.8 18a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4z" />
              </svg>
              <input
                type="text"
                value={globalSearch}
                placeholder="Pesquise por nome, CPF ou beneficio..."
                aria-label="Busca global"
                onFocus={() => setSearchOpen(true)}
                onChange={handleSearchInputChange}
                onKeyDown={handleSearchKeyDown}
              />
            </label>

            {searchOpen && (
              <div className="searchDropdown" role="listbox" aria-label="Resultados da busca">
                {trimmedGlobalSearch.length < 2 ? (
                  <p className="searchDropdownState">
                    Digite pelo menos 2 caracteres para buscar.
                  </p>
                ) : searchLoading ? (
                  <p className="searchDropdownState">Buscando...</p>
                ) : searchOptions.length === 0 ? (
                  <p className="searchDropdownState">Nenhum resultado encontrado.</p>
                ) : (
                  searchOptions.map((option, index) => (
                    <button
                      key={option.key}
                      type="button"
                      className={`searchOption${
                        highlightedSearchIndex === index ? " active" : ""
                      }`}
                      onMouseEnter={() => setHighlightedSearchIndex(index)}
                      onClick={() => handleSearchOptionSelect(option)}
                    >
                      <span className="searchOptionScope">{option.scope}</span>
                      <strong>{option.title}</strong>
                      <small>{option.subtitle}</small>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

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
                            <small>{formatDateTimeDisplayValue(notification.created_at, "")}</small>
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
