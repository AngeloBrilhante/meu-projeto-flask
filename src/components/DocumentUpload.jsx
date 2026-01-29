import { useState } from "react";
import { uploadDocuments } from "../services/api";

export default function DocumentUpload({ clientId, onUpload }) {
  const [files, setFiles] = useState({});

  function handleChange(e) {
    setFiles({
      ...files,
      [e.target.name]: e.target.files[0]
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    await uploadDocuments(clientId, files);
    onUpload();
  }

  return (
    <form onSubmit={handleSubmit}>
      <h3>Enviar documentos</h3>

      <input type="file" name="rg" onChange={handleChange} />
      <br />
      <input type="file" name="cpf" onChange={handleChange} />
      <br />
      <input type="file" name="foto" onChange={handleChange} />
      <br />

      <button type="submit">Enviar</button>
    </form>
  );
}
async function handleSubmit(e) {
  e.preventDefault();
  console.log("Clicou em enviar");

  console.log("Arquivos selecionados:", files);

  const response = await uploadDocuments(clientId, files);
  console.log("Resposta da API:", response);

  onUpload();
}
