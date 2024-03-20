import puppeteer from 'puppeteer';
import fetch from 'node-fetch';
import { appendFile } from 'fs/promises';
import moment from 'moment';
import { Upload } from "@aws-sdk/lib-storage";
import { S3 } from "@aws-sdk/client-s3";
import config from './config.js';


async function getAuth_key() {
    return new Promise(async (resolve, reject) => {
        const browser = await puppeteer.launch(
            // { headless: false, }
        );
        const page = await browser.newPage();
        page.setViewport({ width: 500, height: 1500 });
        await page.goto('https://school.novakidschool.com/signin/form/email');
        await page.waitForSelector('button.MuiTypography-inherit');
        await page.click('button.MuiTypography-inherit');
        await page.type('input[name="email"]', config.novakids.user);
        await page.type('input[name="password"]', config.novakids.pass);
        await page.click('button[type="submit"]');
        page.on('request', req => {
            const auth_key = req.headers()['x-novakid-auth'];
            if (auth_key) {
                browser.close();
                resolve(auth_key);
            }
        });
    })
}

async function getClasses(auth_key) {
    const from = moment().add(-1, "months");
    const to = moment().add(2, "months");
    const url = `https://api.novakidschool.com/api/0/users/${config.novakids.parent_id}/classes?start_time__gte=${from.toISOString()}&start_time__lt=${to.toISOString()}&status=done&status=ongoing&status=scheduled&detailed=true`;
    const res = await fetch(url, {
        method: 'GET',
        headers: { 'x-novakid-auth': auth_key }
    });
    const data = await res.json();
    return data._embedded.classes;

}

function createIcsFile(Classes) {
    let data = 'BEGIN:VCALENDAR\n';
    data += 'VERSION:2.0\n';
    data += `PRODID:${config.calendar_name}\n`;
    data += `X-WR-CALDESC:${config.calendar_name}\n`;
    data += `X-WR-CALNAME:${config.calendar_name}\n`;
    data += 'REFRESH-INTERVAL;VALUE=DURATION:PT1H\n';
    data += 'X-PUBLISHED-TTL:PT1H\n';

    Classes.forEach(Class => {
        const startTime = moment.utc(Class.start_time);
        const endTime = moment.utc(Class.start_time).add(Class.duration, 'minute');
        data += 'BEGIN:VEVENT\n';
        data += `DTSTART:${startTime.format('YYYYMMDDTHHmmss')}Z\n`;
        data += `DTEND:${endTime.format('YYYYMMDDTHHmmss')}Z\n`;
        data += `UID:${Class.id}@novakid2calendar\n`;
        data += `SUMMARY:${Class._embedded.student.name} - English lesson\n`;
        data += `DESCRIPTION:`;
        data += `Student: ${Class._embedded.student.name}\\n`;
        data += `Teacher: ${Class._embedded.teacher.name}\\n`;
        data += `\\n\\n`;
        data += `calendar update time: ${moment().format('DD/MM/YYYY HH:mm (ZZ)')}\n`;
        data += 'END:VEVENT\n';
    });
    data += 'END:VCALENDAR';
    return data;
}

async function saveToS3(data) {
    var s3 = new S3({ region: 'us-east-2' });
    await new Upload({
        client: s3,
        params: {
            Bucket: config.aws.s3Bucket,
            Key: config.aws.s3FileKey,
            Body: Buffer.from(data, 'utf8'),
        }
    }).done()
}

async function doJob() {
    const auth_key = await getAuth_key();
    const Classes = await getClasses(auth_key);
    const icsFileData = createIcsFile(Classes)

    await saveToS3(icsFileData);

    await appendFile("log.txt", new Date() + ` - calender file update - ${Classes.length} lessons\n`)
    console.log('done');
}

doJob();

