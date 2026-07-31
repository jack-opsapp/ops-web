import type { ExternalApiDocsCopy } from "@/lib/external-api/docs/copy";
import type { ExternalApiReferenceField } from "@/lib/external-api/docs/reference";

interface SchemaFieldsProps {
  copy: ExternalApiDocsCopy;
  fields: ExternalApiReferenceField[];
}

function FieldDescription({
  copy,
  field,
}: {
  copy: ExternalApiDocsCopy;
  field: ExternalApiReferenceField;
}) {
  return (
    <>
      <span>{field.description ?? copy.noneValue}</span>
      {field.constraints.length > 0 ? (
        <span className="mt-0.5 block font-mono text-micro text-text-3">
          {field.constraints.join(" · ")}
        </span>
      ) : null}
    </>
  );
}

export function SchemaFields({ copy, fields }: SchemaFieldsProps) {
  if (fields.length === 0) return null;

  return (
    <>
      <div className="hidden overflow-x-auto border-y border-line md:block">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-line">
              {[
                copy.nameColumn,
                copy.typeColumn,
                copy.requiredColumn,
                copy.descriptionColumn,
              ].map((heading) => (
                <th
                  key={heading}
                  scope="col"
                  className="px-1 py-1 font-mono text-micro uppercase tracking-wider text-text-3"
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => (
              <tr
                key={field.name}
                className="border-b border-line last:border-b-0"
              >
                <th
                  scope="row"
                  className="px-1 py-1 align-top font-mono text-data-sm font-normal text-text"
                >
                  {field.name}
                </th>
                <td className="px-1 py-1 align-top font-mono text-micro text-text-2">
                  {field.type}
                </td>
                <td className="px-1 py-1 align-top font-mono text-micro text-text-2">
                  {field.required ? copy.requiredValue : copy.optionalValue}
                </td>
                <td className="px-1 py-1 align-top font-mohave text-body-sm text-text-2">
                  <FieldDescription copy={copy} field={field} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="divide-y divide-line border-y border-line md:hidden">
        {fields.map((field) => (
          <div key={field.name} className="py-2">
            <div className="flex flex-wrap items-baseline justify-between gap-1">
              <dt className="font-mono text-data-sm text-text">{field.name}</dt>
              <dd className="font-mono text-micro text-text-2">
                {field.type} ·{" "}
                {field.required ? copy.requiredValue : copy.optionalValue}
              </dd>
            </div>
            <dd className="mt-0.5 font-mohave text-body-sm text-text-2">
              <FieldDescription copy={copy} field={field} />
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}
