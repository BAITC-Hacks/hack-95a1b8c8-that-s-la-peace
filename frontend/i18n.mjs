// Interface translations only. Original profile texts and server explanations
// are deliberately kept in their source language and marked in the UI.
const phrases = {
  'Какая услуга нужна': ['Қандай қызмет қажет', 'What service do you need'],
  'Выберите услугу': ['Қызметті таңдаңыз', 'Choose a service'],
  'Ведение мероприятия': ['Іс-шараны жүргізу', 'Event hosting'],
  'Проведение церемонии': ['Рәсімді жүргізу', 'Ceremony hosting'],
  'Фотосъёмка': ['Фототүсірілім', 'Photography'],
  'Видеосъёмка': ['Бейнетүсірілім', 'Videography'],
  'Живая музыка': ['Жанды музыка', 'Live music'],
  'Инструментальная музыка': ['Аспаптық музыка', 'Instrumental music'],
  'Танцевальное шоу': ['Би шоуы', 'Dance show'],
  'Декор мероприятия': ['Іс-шараны безендіру', 'Event decoration'],
  'Флористика': ['Флористика', 'Floristry'],
  'Ведение и шоу': ['Жүргізу және шоу', 'Hosting and shows'],
  'Фото и видео': ['Фото және бейне', 'Photo and video'],
  'Музыка': ['Музыка', 'Music'],
  'Площадки': ['Өткізу орындары', 'Venues'],
  'Оформление и подарки': ['Безендіру және сыйлықтар', 'Decoration and gifts'],
  'Настройки подбора': ['Іріктеу баптаулары', 'Selection settings'],
  'Как получен результат': ['Нәтиже қалай алынды', 'How these results were selected'],
  'Открыть календарь': ['Күнтізбені ашу', 'Open calendar'],
  'Выбор даты': ['Күнді таңдау', 'Choose a date'],
  'Предыдущий месяц': ['Алдыңғы ай', 'Previous month'],
  'Следующий месяц': ['Келесі ай', 'Next month'],
  'По каталогу, без учёта бюджета, языка и часов. Не итоговая смета.': ['Каталог бойынша, бюджет, тіл және сағаттар ескерілмейді. Соңғы смета емес.', 'Catalog prices, before budget, language and hours. Not a final quote.'],
  'Под датой — свободные профили по каталогу, без учёта бюджета, языка и часов.': ['Күннің астында — каталогтағы бос профильдер саны, бюджет, тіл және сағаттар ескерілмейді.', 'Below each date: available catalog profiles, before budget, language and hours.'],
  'К форме подбора': ['Іріктеу формасына', 'Skip to selection form'],
  'Люди и места для вашего события': ['Іс-шараңызға адамдар мен орындар', 'People and places for your event'],
  'Подбор event-подрядчиков': ['Іс-шараға мердігер таңдау', 'Find event professionals'],
  'Подрядчики под ваше событие.': ['Іс-шараңызға лайық мердігерлер.', 'The right people for your event.'],
  'Расскажите о мероприятии. Получите до трёх подходящих вариантов и понятное объяснение для каждого.': ['Іс-шара туралы айтыңыз. Әрқайсысына түсіндірмесі бар үшке дейін нұсқа алыңыз.', 'Tell us about your event. Get up to three suitable options, each with a clear explanation.'],
  'Ваше мероприятие': ['Сіздің іс-шараңыз', 'Your event'],
  'Начнём с деталей': ['Мәліметтерден бастайық', 'Start with the details'],
  'Пять обязательных полей. Язык и длительность можно уточнить дополнительно.': ['Бес міндетті өріс. Тіл мен ұзақтықты қосымша көрсетуге болады.', 'Five required fields. Working language and duration are optional.'],
  'Город': ['Қала', 'City'], 'Дата события': ['Іс-шара күні', 'Event date'],
  'Дата текстом': ['Күнді мәтінмен енгізу', 'Type a date'],
  'Или введите дату: ДД.ММ.ГГГГ': ['Немесе күнді енгізіңіз: КК.АА.ЖЖЖЖ', 'Or type the date: DD.MM.YYYY'],
  'ДД.ММ.ГГГГ': ['КК.АА.ЖЖЖЖ', 'DD.MM.YYYY'],
  'Формат мероприятия': ['Іс-шара түрі', 'Event format'],
  'Кого или что ищем': ['Кімді немесе нені іздейміз', 'Who or what do you need'],
  'Категория': ['Санат', 'Category'], 'Все категории': ['Барлық санаттар', 'All categories'],
  'Люди и команды': ['Адамдар мен командалар', 'People and teams'],
  'Площадки и услуги': ['Орындар мен қызметтер', 'Venues and services'],
  'Бюджет, ₸': ['Бюджет, ₸', 'Budget, ₸'],
  'На одного подрядчика или площадку за мероприятие.': ['Бір іс-шараға бір мердігерге немесе орынға.', 'Per professional or venue, for one event.'],
  'Язык и длительность · необязательно': ['Тіл мен ұзақтық · міндетті емес', 'Working language and duration · optional'],
  'Язык': ['Жұмыс тілі', 'Working language'], 'Язык интерфейса': ['Интерфейс тілі', 'Interface language'],
  'Длительность, ч': ['Ұзақтығы, сағ', 'Duration, hours'], 'Не указана': ['Көрсетілмеген', 'Not specified'],
  'Например, 1 000 000': ['Мысалы, 1 000 000', 'For example, 1 000 000'],
  'Подобрать варианты': ['Нұсқаларды таңдау', 'Find options'], 'Подбираем варианты…': ['Нұсқалар ізделуде…', 'Finding options…'],
  'Обновлять варианты автоматически': ['Нұсқаларды автоматты жаңарту', 'Update options automatically'],
  'После заполнения пяти полей. Условия не меняются без вашего выбора.': ['Бес өріс толтырылғаннан кейін. Шарттар сіздің таңдауыңызсыз өзгермейді.', 'Once all five fields are complete. Your choices are never changed automatically.'],
  'Ваши варианты': ['Сіздің нұсқаларыңыз', 'Your options'], 'До 3 рекомендаций': ['3 ұсынысқа дейін', 'Up to 3 recommendations'],
  'Демонстрационный каталог. Имена изменены.': ['Демонстрациялық каталог. Есімдер өзгертілген.', 'Demonstration catalog. Names have been changed.'],
  'Цена «от» — нижняя граница из каталога. Итоговую стоимость и условия нужно уточнить у подрядчика.': ['«Бастап» бағасы — каталогтағы төменгі шек. Соңғы баға мен шарттарды мердігерден нақтылаңыз.', '“From” is the starting catalog price. Confirm the final price and terms with the provider.'],
  'Подбор помогает выбрать. Бронирование в сервисе не предусмотрено.': ['Іріктеу таңдауға көмектеседі. Сервисте брондау жоқ.', 'Recommendations help you choose. Booking is not available in this service.'],
  'Данные каталога': ['Каталог деректері', 'Catalog data'], 'Выберите город': ['Қаланы таңдаңыз', 'Choose a city'],
  'Выберите формат': ['Түрін таңдаңыз', 'Choose a format'], 'Выберите категорию': ['Санатты таңдаңыз', 'Choose a category'],
  'Без предпочтений': ['Талғамсыз', 'No preference'], 'Поиск в списке': ['Тізімнен іздеу', 'Search this list'],
  'Показать весь список': ['Толық тізімді көрсету', 'Show the full list'], 'Нет вариантов': ['Нұсқалар жоқ', 'No options'],
  'Все': ['Бәрі', 'All'],
  'Загружаем каталог': ['Каталог жүктелуде', 'Loading catalog'],
  'Проверяем доступные города, категории и календарь.': ['Қалалар, санаттар мен күнтізбені тексереміз.', 'Checking cities, categories and calendar coverage.'],
  'Сервис подбора пока недоступен': ['Іріктеу сервисі әзірге қолжетімсіз', 'Selection service is unavailable'],
  'Подбор ещё не подключён. Рекомендации появятся, когда сервис станет доступен.': ['Іріктеу әлі қосылмаған. Сервис қолжетімді болғанда ұсыныстар пайда болады.', 'Selection is not connected yet. Recommendations will appear when the service is available.'],
  'Не удалось загрузить каталог. Попробуйте ещё раз немного позже.': ['Каталог жүктелмеді. Сәл кейін қайталап көріңіз.', 'The catalog could not be loaded. Please try again shortly.'],
  'Ваше событие начинается с выбора': ['Іс-шараңыз таңдаудан басталады', 'Your event starts with a choice'],
  'Укажите детали мероприятия. Здесь появятся подходящие люди и места — с объяснениями по вашему запросу.': ['Іс-шара мәліметтерін көрсетіңіз. Мұнда сұранысыңызға сай адамдар мен орындар түсіндірмесімен көрсетіледі.', 'Enter your event details to see suitable people and venues, with explanations for your request.'],
  'Выберите город из каталога.': ['Каталогтан қаланы таңдаңыз.', 'Choose a city from the catalog.'],
  'Выберите категорию из каталога.': ['Каталогтан санатты таңдаңыз.', 'Choose a category from the catalog.'],
  'Выберите формат мероприятия.': ['Іс-шара түрін таңдаңыз.', 'Choose an event format.'],
  'Укажите реальную дату мероприятия.': ['Іс-шараның жарамды күнін енгізіңіз.', 'Enter a valid event date.'],
  'Укажите целый бюджет больше нуля, не превышающий 9 007 199 254 740 991 ₸.': ['Нөлден үлкен, 9 007 199 254 740 991 ₸ шамасынан аспайтын бүтін бюджет енгізіңіз.', 'Enter a whole budget above zero, up to 9 007 199 254 740 991 ₸.'],
  'Укажите число часов больше нуля или оставьте поле пустым.': ['Нөлден үлкен сағат санын енгізіңіз немесе бос қалдырыңыз.', 'Enter hours greater than zero, or leave this field blank.'],
  'Выберите язык из каталога.': ['Каталогтан тілді таңдаңыз.', 'Choose a working language from the catalog.'],
  'Подобрали для вас': ['Сізге таңдалған нұсқалар', 'Selected for you'],
  'В этом городе нет такой категории': ['Бұл қалада мұндай санат жоқ', 'This category is not listed in this city'],
  'Кандидаты есть, но не подходят по условиям': ['Үміткерлер бар, бірақ шарттарға сай емес', 'Profiles exist, but none meet these conditions'],
  'Почему подходит': ['Неліктен сәйкес келеді', 'Why it fits'], 'за мероприятие': ['бір іс-шараға', 'per event'],
  'Присутствие по часам неприменимо.': ['Сағаттық қатысу қолданылмайды.', 'On-site hours do not apply.'],
  'Из описания профиля': ['Профиль сипаттамасынан', 'From the profile description'],
  'Исходный каталог': ['Бастапқы каталог', 'Provided catalog'], 'Добавлено командой': ['Команда қосқан', 'Added by the team'],
  'Синтетический профиль в каталоге': ['Каталогтағы синтетикалық профиль', 'Synthetic catalog profile'],
  'Город проставлен при подготовке данных': ['Қала деректерді дайындау кезінде толтырылған', 'City filled during data preparation'],
  'Цена проставлена при подготовке данных': ['Баға деректерді дайындау кезінде толтырылған', 'Price filled during data preparation'],
  'Один профиль может не подходить по нескольким причинам. Эти числа не складываются.': ['Бір профиль бірнеше себеппен сәйкес келмеуі мүмкін. Бұл сандар қосылмайды.', 'One profile can fail several conditions. These counts must not be added together.'],
  'Можно изменить условия': ['Шарттарды өзгертуге болады', 'You can adjust the conditions'],
  'Изменим только выбранное условие после вашего нажатия.': ['Батырманы басқаннан кейін тек таңдалған шарт өзгереді.', 'Only the selected condition changes, after you click.'],
  'Новый бюджет сравнивается с ценой «от», не с подтверждённой стоимостью заказа.': ['Жаңа бюджет расталған жалпы құнмен емес, бастапқы бағамен салыстырылады.', 'The new budget is compared with starting prices, not a confirmed total price.'],
  'Проверьте детали мероприятия': ['Іс-шара мәліметтерін тексеріңіз', 'Check your event details'],
  'Исправьте отмеченные поля. Остальные значения сохранены.': ['Белгіленген өрістерді түзетіңіз. Басқа мәндер сақталды.', 'Correct the highlighted fields. Your other values have been kept.'],
  'Ищем подходящие варианты': ['Сәйкес нұсқалар ізделуде', 'Looking for suitable options'],
  'Учитываем параметры запроса и занятость на выбранную дату.': ['Сұраныс шарттары мен таңдалған күндегі бос уақыт ескеріледі.', 'Checking your conditions and availability on the selected date.'],
  'Не удалось выполнить подбор': ['Іріктеу орындалмады', 'Could not complete the selection'],
  'Сервис временно недоступен. Ваши параметры сохранены — попробуйте ещё раз.': ['Сервис уақытша қолжетімсіз. Шарттарыңыз сақталды — қайталап көріңіз.', 'The service is temporarily unavailable. Your choices are saved — please try again.'],
  'Попробовать ещё раз': ['Қайталап көру', 'Try again'], 'Детали изменены': ['Мәліметтер өзгерді', 'Details changed'],
  'Запустите подбор, чтобы получить варианты по новым условиям.': ['Жаңа шарттар бойынша нұсқалар алу үшін іріктеуді бастаңыз.', 'Run selection to get options for your updated choices.'],
  'Заполните остальные поля — варианты обновятся автоматически.': ['Қалған өрістерді толтырыңыз — нұсқалар автоматты жаңарады.', 'Complete the remaining fields — options will update automatically.'],
  'Описания и объяснения каталога приведены на русском языке.': ['Каталог сипаттамалары мен түсіндірмелері орыс тілінде берілген.', 'Catalog descriptions and explanations are provided in Russian.'],
  'Ценовой ориентир': ['Баға бағдары', 'Price guide'],
  'По городу, категории и формату мероприятия.': ['Қала, санат және іс-шара түрі бойынша.', 'By city, category and event format.'],
  'Выберите город, категорию и формат для справки о ценах и датах.': ['Бағалар мен күндер үшін қаланы, санатты және түрді таңдаңыз.', 'Choose a city, category and format to see prices and dates.'],
  'Начальные цены по каталогу, не итоговая смета. Язык, длительность и бюджет здесь не учтены.': ['Каталогтағы бастапқы бағалар, соңғы смета емес. Тіл, ұзақтық пен бюджет мұнда ескерілмейді.', 'Starting catalog prices, not a final quote. Working language, duration and budget are not included in this guide.'],
  'В этом сочетании нет профилей. Можно выбрать другую категорию или формат.': ['Бұл үйлесімде профильдер жоқ. Басқа санат немесе түр таңдауға болады.', 'No profiles have this combination. You can choose another category or format.'],
  'Доступность по календарю каталога': ['Каталог күнтізбесі бойынша қолжетімділік', 'Availability in the catalog calendar'],
  'Число на дате — свободные профили. Ноль означает, что все заняты. Дату можно выбрать и проверить подбором.': ['Күндегі сан — бос профильдер. Нөл болса, барлығы бос емес. Күнді таңдап, іріктеумен тексеруге болады.', 'The count is available profiles. Zero means all are busy. You can still select the date and run selection.'],
  'Названий мероприятий и ссылок на них в исходных данных нет.': ['Бастапқы деректерде іс-шара атаулары мен сілтемелер жоқ.', 'The source data contains no event names or event links.'],
  'Все варианты остаются доступны: отсутствие совпадений будет объяснено.': ['Барлық нұсқалар қолжетімді: сәйкестік болмаса, себебі түсіндіріледі.', 'All options remain selectable: a lack of matches will be explained.'],
  'Скрывать несовместимые категории и форматы': ['Сәйкес емес санаттар мен түрлерді жасыру', 'Hide incompatible categories and formats'],
  'По городу, категории и формату. Снимите отметку, чтобы увидеть все варианты. Текущий выбор сохраняется.': ['Қала, санат және түр бойынша. Барлық нұсқаны көру үшін белгіні алып тастаңыз. Қазіргі таңдау сақталады.', 'By city, category and format. Uncheck to see every option. Your current selection is kept.'],
  'свадьба': ['үйлену тойы', 'wedding'], 'той': ['той', 'toi celebration'], 'корпоратив': ['корпоратив', 'corporate event'],
  'конференция': ['конференция', 'conference'], 'юбилей': ['мерейтой', 'anniversary'], 'день рождения': ['туған күн', 'birthday'],
  'Алматы': ['Алматы', 'Almaty'], 'Астана': ['Астана', 'Astana'], 'Зарубежье': ['Шетел', 'Abroad'],
  'русский': ['орысша', 'Russian'], 'казахский': ['қазақша', 'Kazakh'], 'английский': ['ағылшынша', 'English'],
  'Ведущий': ['Жүргізуші', 'Host'], 'Фотограф': ['Фотограф', 'Photographer'], 'Видеограф': ['Видеограф', 'Videographer'],
  'Лайв-бэнд': ['Музыкалық топ', 'Live band'], 'Банкетный зал': ['Банкет залы', 'Banquet hall'],
  'Флорист': ['Флорист', 'Florist'], 'Декоратор': ['Безендіруші', 'Decorator'],
  'Ведущий церемонии': ['Рәсім жүргізушісі', 'Ceremony host'],
  'Загородная площадка': ['Қала сыртындағы орын', 'Countryside venue'], 'Инструменталист': ['Аспапшы', 'Instrumentalist'],
  'Национальный ансамбль': ['Ұлттық ансамбль', 'Traditional ensemble'], 'Отель': ['Қонақүй', 'Hotel'],
  'Подарки и сувениры': ['Сыйлықтар мен кәдесыйлар', 'Gifts and souvenirs'], 'Ресторан': ['Мейрамхана', 'Restaurant'],
  'Танцевальный коллектив': ['Би ұжымы', 'Dance group'], 'Фото и видеобудки': ['Фото және бейне кабиналар', 'Photo and video booths'],
  'Шоу-программа': ['Шоу-бағдарлама', 'Show program'],
  'Объяснения составлены по правилам на основе данных каталога.': ['Түсіндірмелер каталог деректері негізіндегі ережелермен жасалған.', 'Explanations use rules based on catalog facts.'],
  'Формулировки объяснений подготовлены языковой моделью на основе профилей.': ['Түсіндірме мәтіндерін тілдік модель профильдер негізінде дайындаған.', 'Explanation wording was prepared by a language model using profile data.'],
  'Языковая модель недоступна. Объяснения составлены по правилам на основе данных каталога.': ['Тілдік модель қолжетімсіз. Түсіндірмелер каталог деректері негізіндегі ережелермен жасалған.', 'The language model is unavailable. Explanations use rules based on catalog facts.'],
  'Первые три выбраны по совпадениям описания с форматом, затем с категорией. При равенстве — по меньшей цене «от».': ['Алғашқы үшеуі сипаттаманың іс-шара түріне, кейін санатқа сәйкестігімен таңдалды. Тең болса — бастапқы баға бойынша.', 'The first three are selected by description matches with the event format, then category, then lower starting price.'],
};

const originals = new WeakMap();
const attributes = new WeakMap();
export function translate(text, locale = 'ru') {
  if (locale === 'ru' || !['kk', 'en'].includes(locale)) return text;
  const index = locale === 'kk' ? 0 : 1;
  if (phrases[text]) return phrases[text][index];
  const templates = [
    [/^(\d+) профилей в каталоге$/, n => [`Каталогта ${n} профиль`, `${n} catalog profiles`]],
    [/^Календарь занятости: (.+) — (.+)\.$/, (a,b) => [`Күнтізбе: ${a} — ${b}.`, `Calendar coverage: ${a} — ${b}.`]],
    [/^Выберите дату с (.+) по (.+)\.$/, (a,b) => [`${a} мен ${b} аралығындағы күнді таңдаңыз.`, `Choose a date from ${a} to ${b}.`]],
    [/^от (.+) ₸$/, n => [`${n} ₸ бастап`, `from ${n} ₸`]],
    [/^На площадке: до (.+) ч\.$/, n => [`Алаңда: ${n} сағатқа дейін.`, `On site: up to ${n} hours.`]],
    [/^В этой категории и городе: (\d+)\. Подходят по условиям: (\d+)\. Показано: (\d+)\.$/, (a,b,c) => [`Осы қала мен санатта: ${a}. Шарттарға сай: ${b}. Көрсетілді: ${c}.`, `In this city and category: ${a}. Eligible: ${b}. Shown: ${c}.`]],
    [/^По проверке сервиса подходят: (\d+)\.$/, n => [`Сервис тексеруі бойынша сәйкес: ${n}.`, `Verified eligible profiles: ${n}.`]],
    [/^Выбрать дату (.+)$/, n => [`${n} күнін таңдау`, `Choose ${n}`]],
    [/^Увеличить бюджет до (.+) ₸$/, n => [`Бюджетті ${n} ₸ дейін арттыру`, `Increase budget to ${n} ₸`]],
    [/^(.+): (\d+) профилей в каталоге$/, (city,n) => [`${translate(city,locale)}: каталогта ${n} профиль`, `${translate(city,locale)}: ${n} catalog profiles`]],
    [/^На выбранную дату свободны: (\d+) из (\d+)\.$/, (a,b) => [`Таңдалған күні бос: ${a} / ${b}.`, `Available on this date: ${a} of ${b}.`]],
    [/^В выбранной группе: (\d+) профилей\.$/, n => [`Таңдалған топта: ${n} профиль.`, `In the selected group: ${n} profiles.`]],
    [/^Начальная цена: (.+) ₸$/, n => [`Бастапқы баға: ${n} ₸`, `Starting price: ${n} ₸`]],
    [/^Начальные цены: (.+) ₸$/, n => [`Бастапқы бағалар: ${n} ₸`, `Starting prices: ${n} ₸`]],
    [/^(.+): (\d+) свободных профилей$/, (date,n) => [`${date}: ${n} бос профиль`, `${date}: ${n} available profiles`]],
    [/^Поиск в списке: (.+)$/, label => [`Тізімнен іздеу: ${translate(label,locale)}`, `Search this list: ${translate(label,locale)}`]],
    [/^Вариантов в списке: (\d+)\. Поиск не меняет выбранное значение\.$/, n => [`Тізімде ${n} нұсқа. Іздеу таңдалған мәнді өзгертпейді.`, `${n} list options. Search does not change your selection.`]],
    [/^Найдено: (\d+)\. Выберите вариант в списке\.(.*)$/, (n,tail) => [`Табылды: ${n}. Тізімнен таңдаңыз.${tail ? ' Таңдалған мән сақталды.' : ''}`, `Found: ${n}. Choose an option in the list.${tail ? ' Your selection is retained.' : ''}`]],
    [/^Нет вариантов\. Измените поиск или покажите весь список\.(.*)$/, tail => [`Нұсқалар жоқ. Іздеуді өзгертіңіз немесе толық тізімді ашыңыз.${tail ? ' Таңдалған мән сақталды.' : ''}`, `No options. Change your search or show the full list.${tail ? ' Your selection is retained.' : ''}`]],
    [/^Языки: (.+)\.$/, languages => [`Тілдер: ${languages.split(', ').map(item=>translate(item,locale)).join(', ')}.`, `Languages: ${languages.split(', ').map(item=>translate(item,locale)).join(', ')}.`]],
    [/^(Заняты на дату|Выше бюджета|Другой формат|Не подходит язык|Не подходит длительность): (\d+)$/, (label,n) => {
      const labels = {'Заняты на дату':['Күні бос емес','Busy on this date'],'Выше бюджета':['Бюджеттен жоғары','Above budget'],'Другой формат':['Басқа түр','Different event format'],'Не подходит язык':['Тіл сәйкес емес','Working language mismatch'],'Не подходит длительность':['Ұзақтық сәйкес емес','Duration mismatch']};
      return [`${labels[label][0]}: ${n}`,`${labels[label][1]}: ${n}`];
    }],
    [/^(.+) · (.+) · (\d{2}\.\d{2}\.\d{4}) · (.+)$/, (city,category,date,format) => Array(2).fill(`${translate(city,locale)} · ${translate(category,locale)} · ${date} · ${translate(format,locale)}`)],
  ];
  for (const [pattern, render] of templates) {
    const match = text.match(pattern);
    if (match) return render(...match.slice(1))[index];
  }
  return text;
}

export function localizeTree(root, locale) {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 4); // SHOW_TEXT; no HTML generation
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement?.closest('[data-catalog-text]')) continue;
    if (!originals.has(node)) originals.set(node, node.nodeValue);
    node.nodeValue = translate(originals.get(node), locale);
  }
  for (const node of root.querySelectorAll('[placeholder], [aria-label]')) {
    if (!attributes.has(node)) attributes.set(node, Object.fromEntries(['placeholder', 'aria-label'].filter(key => node.hasAttribute(key)).map(key => [key, node.getAttribute(key)])));
    for (const [key,value] of Object.entries(attributes.get(node))) node.setAttribute(key, translate(value, locale));
  }
}
