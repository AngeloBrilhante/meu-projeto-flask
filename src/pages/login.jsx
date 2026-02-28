import "./login.css";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { buildApiUrl } from "../config/api";

export default function Login() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleLogin(event) {
    if (event) event.preventDefault();

    if (!email || !senha) {
      setErro("Informe email e senha");
      return;
    }

    setErro("");
    setLoading(true);

    try {
      const response = await fetch(buildApiUrl("/login"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: email.trim(),
          senha: senha.trim(),
        }),
      });

      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error("Resposta invalida do servidor");
      }

      if (!response.ok) {
        setErro(data.message || "Erro ao realizar login");
        return;
      }

      localStorage.setItem("usuario", JSON.stringify(data.user));
      localStorage.setItem("token", data.token);

      const normalizedRole = String(data?.user?.role || "").toUpperCase();
      navigate(normalizedRole.startsWith("DIGITADOR") ? "/pipeline" : "/dashboard");
    } catch (error) {
      setErro("Erro de conexao com o servidor");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="loginPage">
      <div className="loginCard">
        <section className="loginLeft">
          <div className="brandLockup" aria-label="Aureon Capital">
            <h1 className="brandTitle">
              aure<span>/</span>on
            </h1>
            <p className="brandSubtitle">CAPITAL</p>
          </div>

          <p className="loginIntro">Acesse o sistema com seu usuario corporativo.</p>

          <form className="loginForm" onSubmit={handleLogin}>
            <div className="inputGroup">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                placeholder="seuemail@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>

            <div className="inputGroup">
              <label htmlFor="senha">Senha</label>
              <div className="passwordWrap">
                <input
                  id="senha"
                  type={showPassword ? "text" : "password"}
                  placeholder="Digite sua senha"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="passwordToggle"
                  onClick={() => setShowPassword((prev) => !prev)}
                >
                  {showPassword ? "Ocultar" : "Mostrar"}
                </button>
              </div>
            </div>

            {erro && <p className="error">{erro}</p>}

            <div className="buttons">
              <button className="btnPrimary" type="submit" disabled={loading}>
                {loading ? "Entrando..." : "Entrar"}
              </button>
            </div>
          </form>
        </section>

        <section className="loginRight">
          <div className="loginRightContent">
            <p className="eyebrow">Portal Aureon</p>
            <h2>Sistema de consignado com controle total da operacao.</h2>
            <p>
              Acompanhe pipeline, status e produtividade com uma experiencia mais
              fluida e segura.
            </p>
          </div>

          <div className="illustration" aria-hidden="true">
            <div className="illusOrb orbA" />
            <div className="illusOrb orbB" />
            <div className="illusPanel">
              <div className="illusPanelHead" />
              <div className="illusRow" />
              <div className="illusRow small" />
              <div className="illusRow" />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
