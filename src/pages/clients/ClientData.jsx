import { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { updateClient } from "../../services/api";
import {
  DATE_INPUT_PLACEHOLDER,
  formatDateDisplayValue,
  formatDateInputValue,
  normalizeDateInputValue,
} from "../../utils/date";

function formatCurrency(value) {
  const number = Number(value);
  if (Number.isNaN(number)) return "-";
  return number.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatCurrencyInput(value) {
  const number = Number(value);
  if (Number.isNaN(number)) return "";
  return number.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value) {
  return formatDateDisplayValue(value);
}

function formatBool(value) {
  return value ? "Sim" : "Nao";
}

function buildBeneficios(client) {
  if (Array.isArray(client?.beneficios) && client.beneficios.length > 0) {
    return client.beneficios;
  }
  if (client?.numero_beneficio) {
    return [client.numero_beneficio];
  }
  return [""];
}

function buildForm(client) {
  return {
    nome: client?.nome || "",
    cpf: client?.cpf || "",
    data_nascimento: formatDateInputValue(client?.data_nascimento),
    especie: client?.especie || "",
    uf_beneficio: client?.uf_beneficio || "",
    beneficios: buildBeneficios(client),
    salario: formatCurrencyInput(client?.salario),
    nome_mae: client?.nome_mae || "",
    telefone: client?.telefone || "",
    email: client?.email || "",
    analfabeto: Boolean(client?.analfabeto),
    rg_numero: client?.rg_numero || "",
    rg_orgao_exp: client?.rg_orgao_exp || "",
    rg_uf: client?.rg_uf || "",
    rg_data_emissao: formatDateInputValue(client?.rg_data_emissao),
    naturalidade: client?.naturalidade || "",
    cep: client?.cep || "",
    rua: client?.rua || "",
    numero: client?.numero || "",
    bairro: client?.bairro || "",
    cidade: client?.cidade || "",
    estado: client?.estado || "",
  };
}

function getStoredRole() {
  try {
    const raw = localStorage.getItem("usuario");
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    return String(parsed?.role || "").toUpperCase();
  } catch {
    return "";
  }
}

export default function ClientData() {
  const { client, refreshClient } = useOutletContext() || {};
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [cepLoading, setCepLoading] = useState(false);
  const [cepError, setCepError] = useState("");
  const [form, setForm] = useState(() => buildForm(client));
  const lastCepLookupRef = useRef("");
  const cepRequestRef = useRef(0);
  const role = useMemo(() => getStoredRole(), []);
  const canEditClient =
    role === "GLOBAL" || role === "ADMIN" || role === "VENDEDOR";

  useEffect(() => {
    if (!isEditing) {
      setForm(buildForm(client));
    }
  }, [client, isEditing]);

  if (!client) {
    return <p className="clientSectionText">Cliente nao encontrado.</p>;
  }

  const beneficios =
    Array.isArray(form.beneficios) && form.beneficios.length > 0
      ? form.beneficios
      : [""];

  const fields = [
    ["Nome", client.nome],
    ["CPF", client.cpf],
    ["Vendedor", client.vendedor_nome],
    ["Data de nascimento", formatDate(client.data_nascimento)],
    ["Especie", client.especie],
    ["UF do beneficio", client.uf_beneficio],
    [
      "Beneficios",
      Array.isArray(client.beneficios) && client.beneficios.length > 0
        ? client.beneficios.join(", ")
        : client.numero_beneficio,
    ],
    ["Salario", formatCurrency(client.salario)],
    ["Nome da mae", client.nome_mae],
    ["Telefone", client.telefone],
    ["E-mail", client.email || "-"],
    ["Analfabeto", formatBool(client.analfabeto)],
    ["RG", client.rg_numero],
    ["Orgao expedidor", client.rg_orgao_exp],
    ["UF do RG", client.rg_uf],
    ["Data emissao RG", formatDate(client.rg_data_emissao)],
    ["Naturalidade", client.naturalidade],
    ["CEP", client.cep],
    ["Rua", client.rua],
    ["Numero", client.numero],
    ["Bairro", client.bairro],
    ["Cidade", client.cidade],
    ["Estado", client.estado],
  ];

  function onlyDigits(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function formatCep(value) {
    const digits = onlyDigits(value).slice(0, 8);
    if (digits.length <= 5) {
      return digits;
    }

    return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  }

  async function lookupAddressByCep(cepDigits) {
    if (cepDigits.length !== 8 || cepDigits === lastCepLookupRef.current) {
      return;
    }

    const requestId = ++cepRequestRef.current;
    setCepLoading(true);
    setCepError("");

    try {
      const response = await fetch(`https://viacep.com.br/ws/${cepDigits}/json/`);
      const data = await response.json();

      if (requestId !== cepRequestRef.current) {
        return;
      }

      if (!response.ok || data.erro) {
        setCepError("CEP nao encontrado.");
        return;
      }

      setForm((prev) => ({
        ...prev,
        rua: data.logradouro || prev.rua,
        bairro: data.bairro || prev.bairro,
        cidade: data.localidade || prev.cidade,
        estado: data.uf || prev.estado,
      }));
      lastCepLookupRef.current = cepDigits;
    } catch {
      if (requestId !== cepRequestRef.current) {
        return;
      }
      setCepError("Nao foi possivel buscar o endereco.");
    } finally {
      if (requestId === cepRequestRef.current) {
        setCepLoading(false);
      }
    }
  }

  function handleChange(event) {
    const { name, type, value, checked } = event.target;

    if (type === "checkbox") {
      setForm((prev) => ({
        ...prev,
        [name]: checked,
      }));
      return;
    }

    if (name === "data_nascimento" || name === "rg_data_emissao") {
      setForm((prev) => ({
        ...prev,
        [name]: formatDateInputValue(value),
      }));
      return;
    }

    if (name === "cep") {
      const nextCep = formatCep(value);
      const cepDigits = onlyDigits(nextCep);

      setForm((prev) => ({ ...prev, cep: nextCep }));
      setCepError("");

      if (cepDigits.length === 8) {
        lookupAddressByCep(cepDigits);
      } else {
        setCepLoading(false);
        lastCepLookupRef.current = "";
      }

      return;
    }

    if (name === "estado" || name === "uf_beneficio" || name === "rg_uf") {
      setForm((prev) => ({
        ...prev,
        [name]: String(value || "").toUpperCase(),
      }));
      return;
    }

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  }

  function handleBeneficioChange(index, value) {
    setForm((prev) => {
      const nextBeneficios = [...(prev.beneficios || [""])];
      nextBeneficios[index] = value;
      return {
        ...prev,
        beneficios: nextBeneficios,
      };
    });
  }

  function handleAddBeneficio() {
    setForm((prev) => ({
      ...prev,
      beneficios: [...(prev.beneficios || [""]), ""],
    }));
  }

  function handleRemoveBeneficio(index) {
    setForm((prev) => {
      const nextBeneficios = [...(prev.beneficios || [""])].filter(
        (_, currentIndex) => currentIndex !== index
      );
      return {
        ...prev,
        beneficios: nextBeneficios.length > 0 ? nextBeneficios : [""],
      };
    });
  }

  function handleCancel() {
    setIsEditing(false);
    setError("");
    setSuccess("");
    setCepError("");
    setCepLoading(false);
    setForm(buildForm(client));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const normalizedBeneficios = beneficios
        .map((item) => String(item || "").trim())
        .filter(Boolean);

      await updateClient(client.id, {
        ...form,
        numero_beneficio: normalizedBeneficios[0] || "",
        beneficios: normalizedBeneficios,
        data_nascimento: normalizeDateInputValue(form.data_nascimento),
        rg_data_emissao: normalizeDateInputValue(form.rg_data_emissao),
      });
      if (typeof refreshClient === "function") {
        await refreshClient();
      }
      setIsEditing(false);
      setSuccess("Dados atualizados com sucesso.");
    } catch (err) {
      setError(err.message || "Erro ao atualizar cliente");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="clientSection">
      <div className="clientSectionHeader">
        <div>
          <h2>Dados do cliente</h2>
          <p className="clientSectionText">
            {isEditing
              ? "Edite os dados abaixo e salve quando concluir."
              : "Visualizacao completa dos dados cadastrados."}
          </p>
        </div>

        {!isEditing && canEditClient && (
          <button
            type="button"
            className="clientPrimaryButton"
            onClick={() => {
              setError("");
              setSuccess("");
              setIsEditing(true);
            }}
          >
            Editar dados
          </button>
        )}
      </div>

      {error && <p className="clientFeedbackError">{error}</p>}
      {success && <p className="clientFeedbackSuccess">{success}</p>}

      {isEditing ? (
        <form className="clientEditForm" onSubmit={handleSubmit}>
          <div className="clientEditGrid">
            <label className="clientEditField">
              <span>Nome</span>
              <input name="nome" value={form.nome} onChange={handleChange} />
            </label>

            <label className="clientEditField">
              <span>CPF</span>
              <input name="cpf" value={form.cpf} onChange={handleChange} inputMode="numeric" />
            </label>

            <label className="clientEditField">
              <span>Data de nascimento</span>
              <input
                name="data_nascimento"
                value={form.data_nascimento}
                onChange={handleChange}
                inputMode="numeric"
                placeholder={DATE_INPUT_PLACEHOLDER}
              />
            </label>

            <label className="clientEditField">
              <span>Especie</span>
              <input name="especie" value={form.especie} onChange={handleChange} />
            </label>

            <label className="clientEditField">
              <span>UF do beneficio</span>
              <input name="uf_beneficio" value={form.uf_beneficio} onChange={handleChange} maxLength={2} />
            </label>

            <div className="clientEditField clientBenefitsField">
              <div className="clientFieldHeader">
                <span>Beneficios</span>
                <button
                  type="button"
                  className="clientGhostButton"
                  onClick={handleAddBeneficio}
                >
                  +
                </button>
              </div>
              <div className="clientBenefitsList">
                {beneficios.map((beneficio, index) => (
                  <div key={`beneficio-${index}`} className="clientBenefitRow">
                    <input
                      value={beneficio}
                      onChange={(event) =>
                        handleBeneficioChange(index, event.target.value)
                      }
                      inputMode="numeric"
                    />
                    {beneficios.length > 1 && (
                      <button
                        type="button"
                        className="clientGhostButton"
                        onClick={() => handleRemoveBeneficio(index)}
                      >
                        Remover
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <label className="clientEditField">
              <span>Salario</span>
              <input
                name="salario"
                value={form.salario}
                onChange={handleChange}
                inputMode="decimal"
                placeholder="1.650,50"
              />
            </label>

            <label className="clientEditField">
              <span>Nome da mae</span>
              <input name="nome_mae" value={form.nome_mae} onChange={handleChange} />
            </label>

            <label className="clientEditField">
              <span>Telefone</span>
              <input name="telefone" value={form.telefone} onChange={handleChange} inputMode="numeric" />
            </label>

            <label className="clientEditField">
              <span>E-mail (opcional)</span>
              <input name="email" type="email" value={form.email} onChange={handleChange} />
            </label>

            <label className="clientEditField">
              <span>RG</span>
              <input name="rg_numero" value={form.rg_numero} onChange={handleChange} />
            </label>

            <label className="clientEditField">
              <span>Orgao expedidor</span>
              <input name="rg_orgao_exp" value={form.rg_orgao_exp} onChange={handleChange} />
            </label>

            <label className="clientEditField">
              <span>UF do RG</span>
              <input name="rg_uf" value={form.rg_uf} onChange={handleChange} maxLength={2} />
            </label>

            <label className="clientEditField">
              <span>Data emissao RG</span>
              <input
                name="rg_data_emissao"
                value={form.rg_data_emissao}
                onChange={handleChange}
                inputMode="numeric"
                placeholder={DATE_INPUT_PLACEHOLDER}
              />
            </label>

            <label className="clientEditField">
              <span>Naturalidade</span>
              <input name="naturalidade" value={form.naturalidade} onChange={handleChange} />
            </label>

            <label className="clientEditField">
              <span>CEP</span>
              <input name="cep" value={form.cep} onChange={handleChange} inputMode="numeric" />
              {cepLoading && (
                <small className="clientFieldHint">Buscando endereco...</small>
              )}
              {!cepLoading && cepError && (
                <small className="clientFieldError">{cepError}</small>
              )}
            </label>

            <label className="clientEditField">
              <span>Rua</span>
              <input name="rua" value={form.rua} onChange={handleChange} />
            </label>

            <label className="clientEditField">
              <span>Numero</span>
              <input name="numero" value={form.numero} onChange={handleChange} />
            </label>

            <label className="clientEditField">
              <span>Bairro</span>
              <input name="bairro" value={form.bairro} onChange={handleChange} />
            </label>

            <label className="clientEditField">
              <span>Cidade</span>
              <input name="cidade" value={form.cidade} onChange={handleChange} />
            </label>

            <label className="clientEditField">
              <span>Estado</span>
              <input
                name="estado"
                value={form.estado}
                onChange={handleChange}
                maxLength={2}
                placeholder="UF"
              />
            </label>

            <label className="clientEditCheckbox">
              <input
                type="checkbox"
                name="analfabeto"
                checked={form.analfabeto}
                onChange={handleChange}
              />
              <span>Cliente analfabeto</span>
            </label>
          </div>

          <div className="clientEditActions">
            <button type="submit" className="clientPrimaryButton" disabled={saving}>
              {saving ? "Salvando..." : "Salvar dados"}
            </button>
            <button type="button" className="clientGhostButton" onClick={handleCancel} disabled={saving}>
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <div className="clientDataGrid">
          {fields.map(([label, value]) => (
            <article key={label}>
              <span>{label}</span>
              <strong>{String(value || "-")}</strong>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
