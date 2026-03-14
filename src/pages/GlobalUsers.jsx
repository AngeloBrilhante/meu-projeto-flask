import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createCompany,
  createUser,
  deleteUser,
  listCompanies,
  listUsers,
} from "../services/api";
import "./GlobalUsers.css";

const ROLE_OPTIONS = [
  { value: "ADMIN", label: "Admin" },
  { value: "VENDEDOR", label: "Vendedor" },
  { value: "DIGITADOR_PORT_REFIN", label: "Digitador Port/Refin" },
  { value: "DIGITADOR_NOVO_CARTAO", label: "Digitador Novo/Cartao" },
  { value: "GLOBAL", label: "Global" },
];

function getStoredUser() {
  try {
    const raw = localStorage.getItem("usuario");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getStoredRole() {
  return String(getStoredUser()?.role || "").toUpperCase();
}

function roleLabel(role) {
  return (
    ROLE_OPTIONS.find((option) => option.value === String(role || "").toUpperCase())?.label ||
    String(role || "-")
  );
}

export default function GlobalUsers() {
  const navigate = useNavigate();
  const storedUser = useMemo(() => getStoredUser(), []);
  const role = useMemo(() => getStoredRole(), []);
  const isGlobal = role === "GLOBAL";

  const [form, setForm] = useState({
    nome: "",
    email: "",
    senha: "",
    role: "ADMIN",
    empresa_id: "",
  });
  const [confirmSenha, setConfirmSenha] = useState("");
  const [companies, setCompanies] = useState([]);
  const [users, setUsers] = useState([]);
  const [filters, setFilters] = useState({
    empresa_id: "",
    role: "",
    q: "",
  });
  const [companyForm, setCompanyForm] = useState({
    nome: "",
    slug: "",
  });
  const [loading, setLoading] = useState(false);
  const [companyLoading, setCompanyLoading] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createSuccess, setCreateSuccess] = useState("");
  const [companyError, setCompanyError] = useState("");
  const [companySuccess, setCompanySuccess] = useState("");
  const [listError, setListError] = useState("");

  useEffect(() => {
    if (!isGlobal) {
      navigate("/dashboard", { replace: true });
    }
  }, [isGlobal, navigate]);

  async function loadCompaniesAndUsers(activeFilters = filters) {
    setListError("");
    setUsersLoading(true);

    try {
      const [companiesResponse, usersResponse] = await Promise.all([
        listCompanies(),
        listUsers(activeFilters),
      ]);

      const companyItems = Array.isArray(companiesResponse?.companies)
        ? companiesResponse.companies
        : [];
      const userItems = Array.isArray(usersResponse?.users) ? usersResponse.users : [];

      setCompanies(companyItems);
      setUsers(userItems);
      setForm((prev) => {
        if (prev.empresa_id || !companyItems[0]) return prev;
        return { ...prev, empresa_id: String(companyItems[0].id) };
      });
    } catch (requestError) {
      setListError(requestError.message || "Nao foi possivel carregar os usuarios.");
    } finally {
      setUsersLoading(false);
    }
  }

  useEffect(() => {
    if (!isGlobal) return;
    loadCompaniesAndUsers();
  }, [isGlobal]);

  function handleChange(field, value) {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  function handleFilterChange(field, value) {
    setFilters((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  function handleCompanyChange(field, value) {
    setCompanyForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setCreateError("");
    setCreateSuccess("");

    const nome = String(form.nome || "").trim();
    const email = String(form.email || "").trim();
    const senha = String(form.senha || "");
    const roleValue = String(form.role || "").trim();
    const empresaId = String(form.empresa_id || "").trim();

    if (!nome || !email || !senha || !roleValue || !empresaId) {
      setCreateError("Preencha todos os campos.");
      return;
    }

    if (senha.length < 6) {
      setCreateError("A senha deve ter no minimo 6 caracteres.");
      return;
    }

    if (senha !== confirmSenha) {
      setCreateError("As senhas nao conferem.");
      return;
    }

    try {
      setLoading(true);
      const result = await createUser({
        nome,
        email,
        senha,
        role: roleValue,
        empresa_id: Number(empresaId),
      });
      const created = result?.user || {};
      setCreateSuccess(
        `Usuario criado: ${created.nome || nome} (${created.email || email}) - ${roleLabel(created.role || roleValue)}`
      );
      setForm({
        nome: "",
        email: "",
        senha: "",
        role: "ADMIN",
        empresa_id: empresaId,
      });
      setConfirmSenha("");
      await loadCompaniesAndUsers(filters);
    } catch (requestError) {
      setCreateError(requestError.message || "Nao foi possivel criar o usuario.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateCompany(event) {
    event.preventDefault();
    setCompanyError("");
    setCompanySuccess("");

    const nome = String(companyForm.nome || "").trim();
    const slug = String(companyForm.slug || "").trim();

    if (!nome) {
      setCompanyError("Informe o nome da empresa.");
      return;
    }

    try {
      setCompanyLoading(true);
      const result = await createCompany({ nome, slug });
      const created = result?.company;
      setCompanyForm({ nome: "", slug: "" });
      setCompanySuccess(`Empresa criada: ${created?.nome || nome}`);
      await loadCompaniesAndUsers(filters);
      if (created?.id) {
        setForm((prev) => ({ ...prev, empresa_id: String(created.id) }));
      }
    } catch (requestError) {
      setCompanyError(requestError.message || "Nao foi possivel criar a empresa.");
    } finally {
      setCompanyLoading(false);
    }
  }

  async function handleApplyFilters(event) {
    event.preventDefault();
    await loadCompaniesAndUsers(filters);
  }

  async function handleClearFilters() {
    const nextFilters = { empresa_id: "", role: "", q: "" };
    setFilters(nextFilters);
    await loadCompaniesAndUsers(nextFilters);
  }

  async function handleDeleteUser(targetUser) {
    const targetId = Number(targetUser?.id);
    if (!Number.isFinite(targetId) || targetId <= 0) return;

    const targetName = String(targetUser?.nome || "usuario").trim();
    const confirmed = window.confirm(`Excluir ${targetName}? Essa acao exige o codigo 2FA do authenticator.`);
    if (!confirmed) return;

    const twofaCode = window.prompt("Digite o codigo 2FA de 6 digitos para confirmar a exclusao:");
    if (twofaCode === null) return;

    try {
      setListError("");
      await deleteUser(targetId, twofaCode);
      setCreateSuccess(`Usuario excluido: ${targetName}`);
      await loadCompaniesAndUsers(filters);
    } catch (requestError) {
      setListError(requestError.message || "Nao foi possivel excluir o usuario.");
    }
  }

  return (
    <div className="globalUsersPage">
      <div className="globalUsersHead">
        <h1>Usuarios e empresas</h1>
        <p>Area exclusiva do perfil global para criar empresas, usuarios e administrar acessos.</p>
      </div>

      <section className="globalUsersCard">
        <h2>Empresas</h2>
        {companyError && <p className="globalUsersMessage error">{companyError}</p>}
        {companySuccess && <p className="globalUsersMessage success">{companySuccess}</p>}

        <form className="globalUsersForm" onSubmit={handleCreateCompany}>
          <label>
            Nome da empresa
            <input
              type="text"
              value={companyForm.nome}
              onChange={(event) => handleCompanyChange("nome", event.target.value)}
              placeholder="Ex.: JRCRED"
            />
          </label>

          <label>
            Slug
            <input
              type="text"
              value={companyForm.slug}
              onChange={(event) => handleCompanyChange("slug", event.target.value)}
              placeholder="Ex.: jrcred"
            />
          </label>

          <button type="submit" disabled={companyLoading}>
            {companyLoading ? "Criando empresa..." : "Criar empresa"}
          </button>
        </form>
      </section>

      <section className="globalUsersCard">
        <h2>Novo usuario</h2>
        {createError && <p className="globalUsersMessage error">{createError}</p>}
        {createSuccess && <p className="globalUsersMessage success">{createSuccess}</p>}

        <form className="globalUsersForm" onSubmit={handleSubmit}>
          <label>
            Nome
            <input
              type="text"
              value={form.nome}
              onChange={(event) => handleChange("nome", event.target.value)}
              placeholder="Nome completo"
              required
            />
          </label>

          <label>
            Email
            <input
              type="email"
              value={form.email}
              onChange={(event) => handleChange("email", event.target.value)}
              placeholder="email@dominio.com"
              required
            />
          </label>

          <label>
            Perfil
            <select
              value={form.role}
              onChange={(event) => handleChange("role", event.target.value)}
              required
            >
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Empresa
            <select
              value={form.empresa_id || ""}
              onChange={(event) => handleChange("empresa_id", event.target.value)}
              required
            >
              <option value="">Selecione</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.nome}
                </option>
              ))}
            </select>
          </label>

          <label>
            Senha
            <input
              type="password"
              value={form.senha}
              onChange={(event) => handleChange("senha", event.target.value)}
              placeholder="Minimo 6 caracteres"
              required
            />
          </label>

          <label>
            Confirmar senha
            <input
              type="password"
              value={confirmSenha}
              onChange={(event) => setConfirmSenha(event.target.value)}
              placeholder="Repita a senha"
              required
            />
          </label>

          <button type="submit" disabled={loading}>
            {loading ? "Criando..." : "Criar usuario"}
          </button>
        </form>
      </section>

      <section className="globalUsersCard">
        <div className="globalUsersSectionHead">
          <div>
            <h2>Usuarios cadastrados</h2>
            <p>Filtre por empresa e perfil, e exclua com confirmacao por authenticator.</p>
          </div>
          <span className="globalUsersCount">{users.length} usuario(s)</span>
        </div>

        {listError && <p className="globalUsersMessage error">{listError}</p>}

        <form className="globalUsersFilters" onSubmit={handleApplyFilters}>
          <label>
            Empresa
            <select
              value={filters.empresa_id}
              onChange={(event) => handleFilterChange("empresa_id", event.target.value)}
            >
              <option value="">Todas</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.nome}
                </option>
              ))}
            </select>
          </label>

          <label>
            Perfil
            <select
              value={filters.role}
              onChange={(event) => handleFilterChange("role", event.target.value)}
            >
              <option value="">Todos</option>
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="globalUsersFiltersSearch">
            Busca
            <input
              type="text"
              value={filters.q}
              onChange={(event) => handleFilterChange("q", event.target.value)}
              placeholder="Nome, email ou empresa"
            />
          </label>

          <div className="globalUsersFilterActions">
            <button type="submit" disabled={usersLoading}>
              {usersLoading ? "Filtrando..." : "Filtrar"}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={handleClearFilters}
              disabled={usersLoading}
            >
              Limpar
            </button>
          </div>
        </form>

        <div className="globalUsersTableWrap">
          <table className="globalUsersTable">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Email</th>
                <th>Empresa</th>
                <th>Perfil</th>
                <th>2FA</th>
                <th>Acao</th>
              </tr>
            </thead>
            <tbody>
              {usersLoading ? (
                <tr>
                  <td colSpan="6" className="globalUsersEmpty">
                    Carregando usuarios...
                  </td>
                </tr>
              ) : users.length ? (
                users.map((item) => {
                  const isSelf = Number(item.id) === Number(storedUser?.id);
                  return (
                    <tr key={item.id}>
                      <td>{item.nome || "-"}</td>
                      <td>{item.email || "-"}</td>
                      <td>{item.empresa?.nome || "-"}</td>
                      <td>{roleLabel(item.role)}</td>
                      <td>{item.twofa_enabled ? "Ativo" : "Inativo"}</td>
                      <td>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => handleDeleteUser(item)}
                          disabled={isSelf}
                          title={isSelf ? "Voce nao pode excluir sua propria conta" : "Excluir usuario"}
                        >
                          Excluir
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="6" className="globalUsersEmpty">
                    Nenhum usuario encontrado com os filtros atuais.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
