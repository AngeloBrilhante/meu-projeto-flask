import "./Login.css";
import { useNavigate } from "react-router-dom";

export default function Login() {
  const navigate = useNavigate();

  function goToDashboard() {
    navigate("/dashboard");
  }

  return (
    <div className="loginPage">
      <div className="loginCard">
        {/* Lado esquerdo */}
        <div className="loginLeft">
          <div className="brand">
            <div className="logo">🪙</div>
            <h2>Bem-Vindo a</h2>
            <h1>JR Cred</h1>
          </div>

          <p>
            A solução para o seu bolso.
          </p>
        </div>

        {/* Lado direito */}
        <div className="loginRight">
          <h2>Seja bem-vindo</h2>

          <form>
            <div className="inputGroup">
              <label>Usúario</label>
              <input type="text" placeholder="Digite seu usúario" />
            </div>

            <div className="inputGroup">
              <label>Endereço de E-mail</label>
              <input type="email" placeholder="Insira seu e-mail" />
            </div>

            <div className="inputGroup">
              <label>Senha</label>
              <input type="password" placeholder="Insira sua senha" />
            </div>

            <div className="terms">
              <input type="checkbox" />
              <span>Concordo com os Termos e Condições.</span>
            </div>

            <div className="buttons">
              <button
                type="button"
                className="btnPrimary"
                onClick={goToDashboard}
              >
                Sign Up
              </button>

              <button
                type="button"
                className="btnSecondary"
                onClick={goToDashboard}
              >
                Sign In
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
