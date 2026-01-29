import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import "./ClientsList.css";

export default function ClientsList() {
  const [clients, setClients] = useState([]);
  const [search, setSearch] = useState("");
  const [filterBy, setFilterBy] = useState("all");

  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem("clients")) || [];
    setClients(stored);
  }, []);

  function handleDeleteClient(id) {
    const updated = clients.filter((client) => client.id !== id);
    setClients(updated);
    localStorage.setItem("clients", JSON.stringify(updated));
  }

  const filteredClients = clients.filter((client) => {
    if (!search) return true;

    if (filterBy === "all") {
      return Object.values(client)
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase());
    }

    return (
      client[filterBy] &&
      client[filterBy]
        .toString()
        .toLowerCase()
        .includes(search.toLowerCase())
    );
  });

  return (
    
      <div className="clientsCard">
        <h2>Gerenciar Clientes</h2>

        {/* FILTRO */}
        <div className="filterBar">
          <div className="searchBox">
            <span className="searchIcon">&#128269;</span>
            <input
              type="text"
              placeholder="Buscar cliente..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="filterWrapper">
            <button type="button" className="filterBtn">
              &#9881;
            </button>

            <select
              value={filterBy}
              onChange={(e) => setFilterBy(e.target.value)}
            >
              <option value="all">Todos</option>
              <option value="nome">Nome</option>
              <option value="beneficio">Benefício</option>
              <option value="cpf">CPF</option>
              <option value="email">Email</option>
            </select>
          </div>
        </div>

        {/* CABEÇALHO */}
        <div className="tableHeader">
          <span>Nome</span>
          <span>Benefício</span>
          <span>Ações</span>
        </div>

        {/* LISTA */}
        <ul className="clientsList">
          {filteredClients.map((client) => (
            <li key={client.id} className="clientRow">
              <span>{client.nome}</span>
              <span>{client.beneficio}</span>

              <div className="actions">
                <Link to={`/clients/${client.id}`}>
                  <button type="button" className="btnDocs">
                    Docs
                  </button>
                </Link>

                <button
                  type="button"
                  className="btnDelete"
                  onClick={() => handleDeleteClient(client.id)}
                >
                  Excluir
                </button>
              </div>
            </li>
          ))}
        </ul>

        {filteredClients.length === 0 && (
          <p className="emptyText">Nenhum cliente encontrado</p>
        )}
      </div>
    
  );
}
