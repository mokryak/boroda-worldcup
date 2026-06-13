import { ArrowRight, Mail, MessageCircle } from "lucide-react";
import type { RememberedEditIdentity } from "../editMemory";
import { appHref } from "../routing";

type PredictInfoPageProps = {
  rememberedIdentity: RememberedEditIdentity | null;
};

export function PredictInfoPage({ rememberedIdentity }: PredictInfoPageProps) {
  const rememberedEditHref = rememberedIdentity ? appHref(`/edit/${rememberedIdentity.editToken}`) : null;

  return (
    <div className="stack">
      <section className="panel intro-grid">
        <div>
          <p className="eyebrow">Подача прогноза</p>
          <h2>Прогноз редактируется по личной ссылке</h2>
          <p>
            Новых участников через сайт больше не добавляем. Если вы уже получили секретную ссылку,
            откройте ее и меняйте прогноз там.
          </p>
          {rememberedIdentity?.displayName && (
            <div className="notice success remembered-player">
              <strong>Мы вас узнали: {rememberedIdentity.displayName}</strong>
            </div>
          )}
        </div>
        {rememberedEditHref && (
          <div className="action-strip">
            <a className="primary-action" href={rememberedEditHref}>
              Открыть мой прогноз
              <ArrowRight size={18} aria-hidden />
            </a>
          </div>
        )}
      </section>

      <section className="panel prediction-help">
        <div>
          <p className="eyebrow">Нет ссылки?</p>
          <h2>Напишите организатору</h2>
          <p>
            Если личной ссылки нет или она потерялась, напишите, и я пришлю ее заново.
          </p>
        </div>
        <div className="contact-actions">
          <a className="secondary-action" href="mailto:mokryak@gmail.com">
            <Mail size={18} aria-hidden />
            mokryak@gmail.com
          </a>
          <a className="secondary-action" href="https://t.me/mokryak" rel="noreferrer" target="_blank">
            <MessageCircle size={18} aria-hidden />
            @mokryak
          </a>
        </div>
      </section>
    </div>
  );
}
