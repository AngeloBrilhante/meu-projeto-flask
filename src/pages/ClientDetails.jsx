import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import ClientDocuments from "./ClientDocuments";
import "./ClientDetails.css";

export default function ClientDetails() {
  const { id } = useParams();
  const [client, setClient] = useState(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem("clients")) || [];
    const found = stored.find(c => c.id.toString() === id);
    setClient(found);
  }, [id]);

  function handleChange(e) {
    setClient({ ...client, [e.target.name]: e.target.value });
  }

  function saveChanges() {
    const stored = JSON.parse(localStorage.getItem("clients")) || [];
    const updated = stored.map(c =>
      c.id.toString() === id ? client : c
    );
    localStorage.setItem("clients", JSON.stringify(updated));
    setEditing(false);
  }

  if (!client) return <p>Cliente não encontrado.</p>;

  return (
    <div className="clientDetailsPage">
      <div className="clientCard">
        <h2>{client.nome}</h2>

        {editing ? (
          <>
            <input name="nome" value={client.nome} onChange={handleChange} />
            <input name="idade" value={client.idade} onChange={handleChange} />
            <input name="telefone" value={client.telefone} onChange={handleChange} />
            <input name="cpf" value={client.cpf} onChange={handleChange} />
            <input name="beneficio" value={client.beneficio} onChange={handleChange} />

            <button onClick={saveChanges}>💾 Salvar</button>
          </>
        ) : (
          <>
            <p><strong>Idade:</strong> {client.idade}</p>
            <p><strong>Telefone:</strong> {client.telefone}</p>
            <p><strong>CPF:</strong> {client.cpf}</p>
            <p><strong>Benefício:</strong> {client.beneficio}</p>

            <button onClick={() => setEditing(true)}>✏️ Editar Dados</button>
          </>
        )}
      </div>

      {/* DOCUMENTOS */}
      <ClientDocuments clientId={client.id} />
    </div>
  );
}
