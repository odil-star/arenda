import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ru from "./ru.json";
import uz from "./uz.json";

export type Resources = typeof ru;
export type ValidationKey = `validation.${keyof Resources["validation"]}`;

// uz.json обязан иметь ту же структуру ключей, что и ru.json — проверяется при сборке
const uzChecked: Resources = uz;

const LANG_KEY = "lang";

function initialLanguage(): "ru" | "uz" {
  try {
    return localStorage.getItem(LANG_KEY) === "uz" ? "uz" : "ru";
  } catch {
    return "ru";
  }
}

void i18n.use(initReactI18next).init({
  resources: { ru: { translation: ru }, uz: { translation: uzChecked } },
  lng: initialLanguage(),
  fallbackLng: "ru",
  interpolation: { escapeValue: false },
  returnNull: false,
});

document.documentElement.lang = i18n.language;
i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = lng;
  try {
    localStorage.setItem(LANG_KEY, lng);
  } catch {
    /* без сохранения */
  }
});

export default i18n;
