import { Controller, Get, Global, Module, Query } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, Matches } from 'class-validator';
import { Profile, RoutingService } from './routing.service';

const POINT = /^-?\d{1,2}(\.\d+)?,-?\d{1,3}(\.\d+)?$/;
const parse = (s: string) => {
  const [lat, lng] = s.split(',').map(Number);
  return { lat, lng };
};

class RouteQuery {
  @Transform(({ value }) => String(value).replace(/\s/g, '')) @Matches(POINT, { message: 'from deve ser "lat,lng"' }) from: string;
  @Transform(({ value }) => String(value).replace(/\s/g, '')) @Matches(POINT, { message: 'to deve ser "lat,lng"' }) to: string;
  @IsOptional() @IsIn(['driving', 'cycling', 'walking']) profile?: Profile;
}

/** GET /api/routes?from=lat,lng&to=lat,lng&profile=driving — melhor caminho nas ruas */
@Controller('routes')
export class RoutingController {
  constructor(private readonly routing: RoutingService) {}

  @Get()
  route(@Query() q: RouteQuery) {
    return this.routing.route(parse(q.from), parse(q.to), q.profile);
  }
}

@Global()
@Module({ controllers: [RoutingController], providers: [RoutingService], exports: [RoutingService] })
export class RoutingModule {}
