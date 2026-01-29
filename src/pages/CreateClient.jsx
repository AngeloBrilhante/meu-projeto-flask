import "./CreateClient.css";
import { useNavigate } from "react-router-dom";
import { useState } from "react";

export default function CreateClient() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    nome: "",
    idade: "",
    telefone: "",
    cpf: "",
    beneficio: "",
  });

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  function handleSubmit(e) {
    e.preventDefault();

    const newClient = {
      id: Date.now(),
      ...form,
    };

    const stored = JSON.parse(localStorage.getItem("clients")) || [];
    stored.push(newClient);
    localStorage.setItem("clients", JSON.stringify(stored));

    navigate(`/clients/${newClient.id}`);
  }

  return (
    <div className="createClientPage">
      <div className="createClientCard">
        <h2>Cadastrar Cliente</h2>

        <form onSubmit={handleSubmit}>
          <div className="formGrid">
            <div className="inputGroup">
              <label>Nome</label>
              <input name="nome" onChange={handleChange} />
            </div>

            <div className="inputGroup">
              <label>Idade</label>
              <input name="idade" onChange={handleChange} />
            </div>

            <div className="inputGroup">
              <label>Telefone</label>
              <input name="telefone" onChange={handleChange} />
            </div>

            <div className="inputGroup">
              <label>CPF</label>
              <input name="cpf" onChange={handleChange} />
            </div>

            <div className="inputGroup">
              <label>Tipo de Benefício</label>
              <input name="beneficio" onChange={handleChange} />
            </div>
          </div>

          <div className="formActions">
            <button type="submit">Salvar Cliente</button>
          </div>
        </form>
      </div>
    </div>
  );
}
