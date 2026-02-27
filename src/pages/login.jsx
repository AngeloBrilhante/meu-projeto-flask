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

  async function handleLogin() {
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
        throw new Error("Resposta inválida do servidor");
      }

      if (!response.ok) {
        setErro(data.message || "Erro ao realizar login");
        return;
      }

      // salva usuário logado
      localStorage.setItem("usuario", JSON.stringify(data.user))

      // salva token JWT
      localStorage.setItem("token", data.token)


      // redireciona
      const normalizedRole = String(data?.user?.role || "").toUpperCase();
      navigate(normalizedRole.startsWith("DIGITADOR") ? "/pipeline" : "/dashboard");

    } catch (error) {
      setErro("Erro de conexão com o servidor");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="loginPage">
      <div className="loginCard">
        <div className="loginLeft">
          <div className="brand">
            <div className="logo">🪙</div>
            <h2>Bem-Vindo a</h2>
            <h1>JR Cred</h1>
          </div>
          <p>A solução para o seu bolso.</p>
        </div>

        <div className="loginRight">
          <h2>Seja bem-vindo</h2>

          <div className="inputGroup">
            <label>Email</label>
            <input
              type="email"
              placeholder="Insira seu e-mail"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="inputGroup">
            <label>Senha</label>
            <input
              type="password"
              placeholder="Insira sua senha"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
            />
          </div>

          {erro && <p className="error">{erro}</p>}

          <div className="buttons">
            <button
              className="btnPrimary"
              onClick={handleLogin}
              disabled={loading}
            >
              {loading ? "Entrando..." : "Entrar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
