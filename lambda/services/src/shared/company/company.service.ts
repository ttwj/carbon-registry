import { PG_UNIQUE_VIOLATION } from "@drdgvhbh/postgres-error-codes";
import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { CompanyDto } from "../dto/company.dto";
import { QueryFailedError, Repository } from "typeorm";
import { Company } from "../entities/company.entity";
import { CompanyRole } from "../enum/company.role.enum";
import { QueryDto } from "../dto/query.dto";
import { DataListResponseDto } from "../dto/data.list.response";
import { BasicResponseDto } from "../dto/basic.response.dto";
import { CompanyState } from "../enum/company.state.enum";
import { HelperService } from "../util/helpers.service";
import { FindCompanyQueryDto } from "../dto/findCompany.dto";
import { ProgrammeLedgerService } from "../programme-ledger/programme-ledger.service";

@Injectable()
export class CompanyService {
  constructor(
    @InjectRepository(Company) private companyRepo: Repository<Company>,
    private logger: Logger,
    private configService: ConfigService,
    private helperService: HelperService,
    private programmeLedgerService: ProgrammeLedgerService
  ) {}

  async suspend(companyId: number, userId: string, remarks:string, abilityCondition: string): Promise<any> {
    this.logger.verbose("Suspend company", companyId);
    const company = await this.companyRepo
      .createQueryBuilder()
      .where(
        `"companyId" = '${companyId}' and state = '1' ${
          abilityCondition
            ? " AND " +
              this.helperService.parseMongoQueryToSQL(abilityCondition)
            : ""
        }`
      )
      .getOne();
    if (!company) {
      throw new HttpException(
        "No active company found",
        HttpStatus.UNAUTHORIZED
      );
    }
    const result = await this.companyRepo
      .update(
        {
          companyId: companyId,
        },
        {
          state: CompanyState.SUSPENDED,
          remarks: remarks,
        }
      )
      .catch((err: any) => {
        this.logger.error(err);
        return err;
      });

    if (result.affected > 0) {
      if(company.companyRole === CompanyRole.PROGRAMME_DEVELOPER) {
        this.programmeLedgerService.freezeCompany(companyId, remarks, userId)
      }
      else if(company.companyRole === CompanyRole.CERTIFIER) {
        this.programmeLedgerService.revokeCompanyCertifications(companyId, remarks, userId)
      }
      return new BasicResponseDto(
        HttpStatus.OK,
        "Successfully suspended company"
      );
    }
    throw new HttpException(
      "Company suspend failed. Please try again",
      HttpStatus.INTERNAL_SERVER_ERROR
    );
  }

  async activate(companyId: number, abilityCondition: string): Promise<any> {
    this.logger.verbose("revoke company", companyId);
    const company = await this.companyRepo
      .createQueryBuilder()
      .where(
        `"companyId" = '${companyId}' and state = '0' ${
          abilityCondition
            ? " AND " +
              this.helperService.parseMongoQueryToSQL(abilityCondition)
            : ""
        }`
      )
      .getOne();
    if (!company) {
      throw new HttpException(
        "No suspended company found",
        HttpStatus.UNAUTHORIZED
      );
    }
    const result = await this.companyRepo
      .update(
        {
          companyId: companyId,
        },
        {
          state: CompanyState.ACTIVE,
        }
      )
      .catch((err: any) => {
        this.logger.error(err);
        return err;
      });

    if (result.affected > 0) {
      return new BasicResponseDto(
        HttpStatus.OK,
        "Successfully activated company"
      );
    }
    throw new HttpException(
      "Company activate failed. Please try again",
      HttpStatus.INTERNAL_SERVER_ERROR
    );
  }

  async query(query: QueryDto, abilityCondition: string): Promise<any> {
    const resp = await this.companyRepo
      .createQueryBuilder()
      .where(
        this.helperService.generateWhereSQL(
          query,
          this.helperService.parseMongoQueryToSQL(abilityCondition)
        )
      )
      .orderBy(query?.sort?.key && `"${query?.sort?.key}"`, query?.sort?.order)
      .offset(query.size * query.page - query.size)
      .limit(query.size)
      .getManyAndCount();

    return new DataListResponseDto(
      resp.length > 0 ? resp[0] : undefined,
      resp.length > 1 ? resp[1] : undefined
    );
  }

  async findByTaxId(taxId: string): Promise<Company | undefined> {
    const companies = await this.companyRepo.find({
      where: {
        taxId: taxId,
      },
    });
    return companies && companies.length > 0 ? companies[0] : undefined;
  }

  async findByCompanyId(companyId: number): Promise<Company | undefined> {
    const companies = await this.companyRepo.find({
      where: {
        companyId: companyId,
      },
    });
    return companies && companies.length > 0 ? companies[0] : undefined;
  }

  async findByCompanyIds(req: FindCompanyQueryDto): Promise<Company[] | undefined> {
    const data: Company[] = []
    for (let i = 0; i < req.companyIds.length; i++){
      const companies = await this.companyRepo.find({
        where: {
          companyId: req.companyIds[i],
        },
      });
      data.push(companies[0])
    }
    return data && data.length > 0 ? data : undefined;
  }

  async findGovByCountry(countryCode: string): Promise<Company | undefined> {
    const companies = await this.companyRepo.find({
      where: {
        country: countryCode,
        companyRole: CompanyRole.GOVERNMENT,
      },
    });
    return companies && companies.length > 0 ? companies[0] : undefined;
  }

  async create(companyDto: CompanyDto): Promise<Company | undefined> {
    this.logger.verbose("Company create received", companyDto.email);

    return await this.companyRepo.save(companyDto).catch((err: any) => {
      if (err instanceof QueryFailedError) {
        switch (err.driverError.code) {
          case PG_UNIQUE_VIOLATION:
            throw new HttpException(
              "Company tax id already exist",
              HttpStatus.BAD_REQUEST
            );
        }
      }
      return err;
    });
  }
}
