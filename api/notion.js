export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // req.body에서 monthlyRate(한 달 달성률)도 추가로 수신
  const { dateStr, completedNames, uncompletedNames, monthlyRate } = req.body;
  const NOTION_API_KEY = process.env.NOTION_API_KEY;
  const DATABASE_ID = process.env.DATABASE_ID;

  if (!NOTION_API_KEY || !DATABASE_ID) {
    return res.status(500).json({ error: '환경 변수(NOTION_API_KEY, DATABASE_ID)가 설정되지 않았습니다.' });
  }

  const total = completedNames.length + uncompletedNames.length;
  const ratePct = total > 0 ? Math.round((completedNames.length / total) * 100) : 0;
  const dailyRateDecimal = total > 0 ? completedNames.length / total : 0;

  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const [year, month, day] = dateStr.split('-').map(Number);
  const dateObj = new Date(year, month - 1, day);
  const pageTitle = `${dateStr} (${dayNames[dateObj.getDay()]})`;

  // 노션 본문 블록 구성
  const bodyBlocks = [
    {
      object: 'block',
      type: 'callout',
      callout: {
        rich_text: [{ type: 'text', text: { content: `오늘의 루틴 달성률: ${ratePct}% (${completedNames.length}/${total} 완료)` } }],
        icon: { emoji: '💡' }
      }
    },
    {
      object: 'block',
      type: 'heading_3',
      heading_3: { rich_text: [{ type: 'text', text: { content: '✅ 완료한 루틴' } }] }
    }
  ];

  if (completedNames.length === 0) {
    bodyBlocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: '완료한 루틴이 없습니다.' } }], color: 'gray' }
    });
  } else {
    completedNames.forEach(name => {
      bodyBlocks.push({
        object: 'block',
        type: 'to_do',
        to_do: { rich_text: [{ type: 'text', text: { content: name } }], checked: true }
      });
    });
  }

  bodyBlocks.push({
    object: 'block',
    type: 'heading_3',
    heading_3: { rich_text: [{ type: 'text', text: { content: '❌ 미완료 루틴' } }] }
  });

  if (uncompletedNames.length === 0) {
    bodyBlocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: '모든 루틴을 완수했습니다! 🎉' } }], color: 'gray' }
    });
  } else {
    uncompletedNames.forEach(name => {
      bodyBlocks.push({
        object: 'block',
        type: 'to_do',
        to_do: { rich_text: [{ type: 'text', text: { content: name } }], checked: false }
      });
    });
  }

  const headers = {
    "Authorization": `Bearer ${NOTION_API_KEY}`,
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json"
  };

  try {
    // 1. 해당 날짜 페이지 존재 여부 조회
    const queryRes = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
      method: "POST",
      headers,
      body: JSON.stringify({ filter: { property: "Date", date: { equals: dateStr } } })
    });
    const queryData = await queryRes.json();
    const existingPage = queryData.results && queryData.results[0];

    // 노션 DB 속성 설정 (기존 Rate 대신 Daily Rate / Monthly Rate 적용)
    const payloadProperties = {
      "Title": { title: [{ text: { content: pageTitle } }] },
      "Date": { date: { start: dateStr } },
      "Daily Rate": { number: dailyRateDecimal } // 새로운 일일 달성률 속성
    };

    // monthlyRate 값이 전달된 경우 Monthly Rate 속성에 적용 (백분율 값 0~1로 변환)
    if (monthlyRate !== undefined && monthlyRate !== null) {
      const monthlyRateDecimal = monthlyRate > 1 ? monthlyRate / 100 : monthlyRate;
      payloadProperties["Monthly Rate"] = { number: monthlyRateDecimal };
    }

    if (existingPage) {
      // 2-1. 기존 페이지 수정
      await fetch(`https://api.notion.com/v1/pages/${existingPage.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ properties: payloadProperties })
      });

      // 기존 블록 삭제 후 재생성
      const childrenRes = await fetch(`https://api.notion.com/v1/blocks/${existingPage.id}/children`, { headers });
      const childrenData = await childrenRes.json();
      if (childrenData.results) {
        for (const block of childrenData.results) {
          await fetch(`https://api.notion.com/v1/blocks/${block.id}`, { method: 'DELETE', headers });
        }
      }

      await fetch(`https://api.notion.com/v1/blocks/${existingPage.id}/children`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ children: bodyBlocks })
      });
    } else {
      // 2-2. 새 페이지 생성
      await fetch("https://api.notion.com/v1/pages", {
        method: "POST",
        headers,
        body: JSON.stringify({
          parent: { database_id: DATABASE_ID },
          properties: payloadProperties,
          children: bodyBlocks
        })
      });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}