import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createCompany, createUser, listCompanies } from "../services/api";
import "./GlobalUsers.css";

const ROLE_OPTIONS = [
  { value: "ADMIN", label: "Admin" },
  { value: "VENDEDOR", label: "Vendedor" },
  { value: "DIGITADOR_PORT_REFIN", label: "Digitador Port/Refin" },
  { value: "DIGITADOR_NOVO_CARTAO", label: "Digitador Novo/Cartao" },
  { value: "GLOBAL", label: "Global" },
];

function getStoredRole() {
  try {
    const raw = localStorage.getItem("usuario");
    if (!raw) return "";
    const user = JSON.parse(raw);
    return String(user?.role || "").toUpperCase();
  } catch {
    return "";
  }
}

export default function GlobalUsers() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    nome: "",
    email: "",
    senha: "",
    role: "ADMIN",
    empresa_id: "",
  });
  const [confirmSenha, setConfirmSenha] = useState("");
  const [loading, setLoading] = useState(false);
  const [companies, setCompanies] = useState([]);
  const [companyForm, setCompanyForm] = useState({
    nome: "",
    slug: "",
  });
  const [companyLoading, setCompanyLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const role = useMemo(() => getStoredRole(), []);
  const isGlobal = role === "GLOBAL";

  useEffect(() => {
    if (!isGlobal) {
      navigate("/dashboard", { replace: true });
    }
  }, [isGlobal, navigate]);

  useEffect(() => {
    if (!isGlobal) return;

    async function loadCompanies() {
      try {
        const data = await listCompanies();
        const items = Array.isArray(data?.companies) ? data.companies : [];
        setCompanies(items);
        if (items[0] && !form.empresa_id) {
          setForm((prev) => ({
            ...prev,
            empresa_id: String(items[0].id),
          }));
        }
      } catch (requestError) {
        setError(requestError.message || "Nao foi possivel carregar as empresas.");
      }
    }

    loadCompanies();
  }, [isGlobal]);

  function handleChange(field, value) {
    setForm((prev) => ({
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
    setError("");
    setSuccess("");

    const nome = String(form.nome || "").trim();
    const email = String(form.email || "").trim();
    const senha = String(form.senha || "");
    const roleValue = String(form.role || "").trim();
    const empresaId = String(form.empresa_id || "").trim();

    if (!nome || !email || !senha || !roleValue || !empresaId) {
      setError("Preencha todos os campos.");
      return;
    }

    if (senha.length < 6) {
      setError("A senha deve ter no minimo 6 caracteres.");
      return;
    }

    if (senha !== confirmSenha) {
      setError("As senhas nao conferem.");
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
      setSuccess(
        `Usuario criado: ${created.nome || nome} (${created.email || email}) - ${created.role || roleValue}`
      );
      setForm({
        nome: "",
        email: "",
        senha: "",
        role: "ADMIN",
        empresa_id: empresaId,
      });
      setConfirmSenha("");
    } catch (requestError) {
      setError(requestError.message || "Nao foi possivel criar o usuario.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateCompany(event) {
    event.preventDefault();
    setError("");
    setSuccess("");

    const nome = String(companyForm.nome || "").trim();
    const slug = String(companyForm.slug || "").trim();

    if (!nome) {
      setError("Informe o nome da empresa.");
      return;
    }

    try {
      setCompanyLoading(true);
      const result = await createCompany({ nome, slug });
      const created = result?.company;
      const refreshed = await listCompanies();
      const items = Array.isArray(refreshed?.companies) ? refreshed.companies : [];
      setCompanies(items);
      if (created?.id) {
        setForm((prev) => ({ ...prev, empresa_id: String(created.id) }));
      }
      setCompanyForm({ nome: "", slug: "" });
      setSuccess(`Empresa criada: ${created?.nome || nome}`);
    } catch (requestError) {
      setError(requestError.message || "Nao foi possivel criar a empresa.");
    } finally {
      setCompanyLoading(false);
    }
  }

  return (
    <div className="globalUsersPage">
      <div className="globalUsersHead">
        <h1>Criacao de usuarios</h1>
        <p>Area exclusiva do perfil global para criar novos acessos.</p>
      </div>

      <section className="globalUsersCard">
        <h2>Empresas</h2>

        <form className="globalUsersForm" onSubmit={handleCreateCompany}>
          <label>
            Nome da empresa
            <input
              type="text"
              value={companyForm.nome}
              onChange={(event) => handleCompanyChange("nome", event.target.value)}
              placeholder="Ex.: Aureon Capital"
            />
          </label>

          <label>
            Slug
            <input
              type="text"
              value={companyForm.slug}
              onChange={(event) => handleCompanyChange("slug", event.target.value)}
              placeholder="Ex.: aureon-capital"
            />
          </label>

          <button type="submit" disabled={companyLoading}>
            {companyLoading ? "Criando empresa..." : "Criar empresa"}
          </button>
        </form>
      </section>

      <section className="globalUsersCard">
        <h2>Novo usuario</h2>

        {error && <p className="globalUsersMessage error">{error}</p>}
        {success && <p className="globalUsersMessage success">{success}</p>}

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
    </div>
  );
}
