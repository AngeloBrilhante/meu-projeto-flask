import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createUser } from "../services/api";
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
  });
  const [confirmSenha, setConfirmSenha] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const role = useMemo(() => getStoredRole(), []);
  const isGlobal = role === "GLOBAL";

  useEffect(() => {
    if (!isGlobal) {
      navigate("/dashboard", { replace: true });
    }
  }, [isGlobal, navigate]);

  function handleChange(field, value) {
    setForm((prev) => ({
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

    if (!nome || !email || !senha || !roleValue) {
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
      });
      setConfirmSenha("");
    } catch (requestError) {
      setError(requestError.message || "Nao foi possivel criar o usuario.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="globalUsersPage">
      <div className="globalUsersHead">
        <h1>Criacao de usuarios</h1>
        <p>Area exclusiva do perfil global para criar novos acessos.</p>
      </div>

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

